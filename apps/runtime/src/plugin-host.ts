import { Worker } from 'node:worker_threads';
import type { TransferListItem } from 'node:worker_threads';
import type {
  MainToPluginWorkerMessage,
  PluginManifest,
  PluginMetric,
  PluginToMainWorkerMessage,
  QueueTelemetry,
  RuntimeEvent,
  SignalBatchEvent,
} from '@sensync2/core';
import { getSignalBatchTransferables } from '@sensync2/core';
import type { PluginDescriptor, RuntimeSessionClockInfo } from './types.ts';

interface QueuedItem {
  event: RuntimeEvent;
}

interface PluginHostCallbacks {
  onReady: (pluginId: string, manifest: PluginManifest) => void;
  onEmit: (pluginId: string, event: Omit<RuntimeEvent, 'seq' | 'tsMonoMs' | 'sourcePluginId'>) => Promise<void>;
  onError: (pluginId: string, error: Error) => void;
  onMetric: (pluginId: string, metric: PluginMetric) => void;
}

export class PluginHost {
  readonly descriptor: PluginDescriptor;
  private worker: Worker | null = null;
  private callbacks: PluginHostCallbacks;
  private readyResolver: ((manifest: PluginManifest) => void) | null = null;
  private readyRejecter: ((error: Error) => void) | null = null;
  private readyPromise: Promise<PluginManifest>;

  private manifest: PluginManifest | null = null;
  private state: 'starting' | 'running' | 'failed' | 'stopped' = 'starting';
  private lastError: string | undefined;

  private controlQueue: QueuedItem[] = [];
  private dataQueue: QueuedItem[] = [];
  private inFlightSeq: bigint | null = null;

  private telemetry: QueueTelemetry;
  private handlerMsTotal = 0;
  private clockInfo: RuntimeSessionClockInfo;

  constructor(descriptor: PluginDescriptor, callbacks: PluginHostCallbacks, clockInfo: RuntimeSessionClockInfo) {
    this.descriptor = descriptor;
    this.callbacks = callbacks;
    this.clockInfo = clockInfo;
    this.telemetry = {
      pluginId: descriptor.id,
      controlDepth: 0,
      dataDepth: 0,
      maxControlDepth: 0,
      maxDataDepth: 0,
      dropped: 0,
      coalesced: 0,
      avgHandlerMs: 0,
      handled: 0,
    };

    this.readyPromise = new Promise<PluginManifest>((resolve, reject) => {
      this.readyResolver = resolve;
      this.readyRejecter = reject;
    });
  }

  async start(): Promise<PluginManifest> {
    const worker = new Worker(new URL('../../../packages/plugin-sdk/src/worker.ts', import.meta.url), {
      execArgv: ['--import', 'tsx'],
    });
    this.worker = worker;

    worker.on('message', (message: PluginToMainWorkerMessage) => {
      void this.handleWorkerMessage(message);
    });
    worker.on('error', (error) => {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    });
    worker.on('exit', (code) => {
      if (this.state !== 'stopped' && code !== 0) {
        this.fail(new Error(`Plugin worker ${this.descriptor.id} завершился с кодом ${code}`));
      }
      if (this.state !== 'failed') {
        this.state = 'stopped';
      }
    });

    this.post({
      kind: 'plugin.init',
      pluginModulePath: this.descriptor.modulePath,
      pluginConfig: this.descriptor.config,
      sessionStartMonoNs: this.clockInfo.sessionStartMonoNs,
      sessionStartWallMs: this.clockInfo.sessionStartWallMs,
    });

    return this.readyPromise;
  }

  async stop(): Promise<void> {
    if (!this.worker) return;
    this.state = 'stopped';
    try {
      this.post({ kind: 'plugin.shutdown' });
    } catch {
      // Игнорируем ошибку отправки, worker мог уже завершиться.
    }
    const worker = this.worker;
    this.worker = null;
    await worker.terminate();
  }

  getManifest(): PluginManifest | null {
    return this.manifest;
  }

  getState(): 'starting' | 'running' | 'failed' | 'stopped' {
    return this.state;
  }

  getLastError(): string | undefined {
    return this.lastError;
  }

  getTelemetry(): QueueTelemetry {
    return {
      ...this.telemetry,
      controlDepth: this.controlQueue.length,
      dataDepth: this.dataQueue.length,
      avgHandlerMs: this.telemetry.handled > 0 ? this.handlerMsTotal / this.telemetry.handled : 0,
    };
  }

  enqueue(event: RuntimeEvent): { ok: true } | { ok: false; reason: string } {
    if (!this.manifest) {
      return { ok: false, reason: `plugin ${this.descriptor.id} еще не готов` };
    }
    if (this.state !== 'running') {
      return { ok: false, reason: `plugin ${this.descriptor.id} state=${this.state}` };
    }

    if (event.priority === 'control' || event.priority === 'system') {
      if (this.controlQueue.length >= this.manifest.mailbox.controlCapacity) {
        this.telemetry.dropped += 1;
        return { ok: false, reason: `control queue overflow for ${this.descriptor.id}` };
      }
      this.controlQueue.push({ event });
      this.telemetry.maxControlDepth = Math.max(this.telemetry.maxControlDepth, this.controlQueue.length);
      this.pump();
      return { ok: true };
    }

    if (this.dataQueue.length >= this.manifest.mailbox.dataCapacity) {
      if (this.manifest.mailbox.dataPolicy === 'coalesce-latest-per-stream' && event.type === 'signal.batch') {
        const signalEvent = event as SignalBatchEvent;
        const streamId = signalEvent.payload.streamId;
        const existingIndex = this.dataQueue.findIndex((item) => {
          if (item.event.type !== 'signal.batch') return false;
          return (item.event as SignalBatchEvent).payload.streamId === streamId;
        });
        if (existingIndex >= 0) {
          this.dataQueue[existingIndex] = { event };
          this.telemetry.coalesced += 1;
          return { ok: true };
        }
        this.dataQueue.shift();
        this.telemetry.dropped += 1;
      } else {
        this.telemetry.dropped += 1;
        return { ok: false, reason: `data queue overflow for ${this.descriptor.id}` };
      }
    }

    this.dataQueue.push({ event });
    this.telemetry.maxDataDepth = Math.max(this.telemetry.maxDataDepth, this.dataQueue.length);
    this.pump();
    return { ok: true };
  }

  private post(message: MainToPluginWorkerMessage, transferList?: readonly TransferListItem[]): void {
    if (!this.worker) {
      throw new Error(`Plugin worker ${this.descriptor.id} не запущен`);
    }
    if (transferList && transferList.length > 0) {
      this.worker.postMessage(message, transferList);
      return;
    }
    this.worker.postMessage(message);
  }

  private pump(): void {
    if (!this.worker || this.state !== 'running' || this.inFlightSeq !== null) return;

    const next = this.controlQueue.shift() ?? this.dataQueue.shift();
    if (!next) return;

    this.inFlightSeq = next.event.seq;

    const message: MainToPluginWorkerMessage = {
      kind: 'plugin.deliver',
      event: next.event,
    };

    if (next.event.type === 'signal.batch') {
      this.post(message, getSignalBatchTransferables((next.event as SignalBatchEvent).payload));
      return;
    }
    this.post(message);
  }

  private async handleWorkerMessage(message: PluginToMainWorkerMessage): Promise<void> {
    if (message.kind === 'plugin.ready') {
      this.manifest = message.manifest;
      if (message.manifest.id !== this.descriptor.id) {
        this.fail(new Error(`Ожидался plugin id=${this.descriptor.id}, получен ${message.manifest.id}`));
        return;
      }
      this.state = 'running';
      this.callbacks.onReady(this.descriptor.id, message.manifest);
      this.readyResolver?.(message.manifest);
      this.readyResolver = null;
      this.readyRejecter = null;
      this.pump();
      return;
    }

    if (message.kind === 'plugin.emit') {
      await this.callbacks.onEmit(this.descriptor.id, message.event);
      return;
    }

    if (message.kind === 'plugin.ack') {
      if (this.inFlightSeq !== null && this.inFlightSeq !== message.seq) {
        this.callbacks.onError(this.descriptor.id, new Error(`ACK seq mismatch for ${this.descriptor.id}`));
      }
      this.inFlightSeq = null;
      this.telemetry.handled += 1;
      this.handlerMsTotal += message.handledMs;
      this.pump();
      return;
    }

    if (message.kind === 'plugin.telemetry') {
      this.callbacks.onMetric(this.descriptor.id, message.metric);
      return;
    }

    if (message.kind === 'plugin.error') {
      this.fail(new Error(message.message));
      return;
    }

    // plugin.set-timer / plugin.clear-timer зарезервированы под возможный перенос таймеров в main runtime.
  }

  private fail(error: Error): void {
    if (this.state === 'failed' || this.state === 'stopped') return;
    this.state = 'failed';
    this.lastError = error.message;
    this.readyRejecter?.(error);
    this.readyResolver = null;
    this.readyRejecter = null;
    this.callbacks.onError(this.descriptor.id, error);
  }
}
