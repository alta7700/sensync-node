import {
  decodeUiSignalBatchFrame,
  type UiControlMessage,
  type UiFormOption,
  type UiSessionClockInfo,
  type UiStreamDeclaration,
} from '@sensync2/core';
import { TypedArrayRingBufferStore } from './ring-buffer-store.ts';
import type {
  ClientRuntimeNotification,
  ClientRuntimeStateSnapshot,
  ClientTransport,
  StreamBufferStore,
  StreamWindowData,
} from './types.ts';

type UpdateListener = () => void;
type StreamListener = (streamId: string) => void;

export class ClientRuntime {
  private transport: ClientTransport;
  private bufferStore: StreamBufferStore;
  private connected = false;
  private attachCount = 0;
  private connectPromise: Promise<void> | null = null;
  private disconnectPromise: Promise<void> | null = null;
  private sessionId?: string;
  private clock?: UiSessionClockInfo;
  private latestSessionMs = 0;
  private schema?: ClientRuntimeStateSnapshot['schema'];
  private flags: ClientRuntimeStateSnapshot['flags'] = {};
  private streamsById = new Map<string, UiStreamDeclaration>();
  private streamsByNumericId = new Map<number, UiStreamDeclaration>();
  private formOptionsBySourceId = new Map<string, UiFormOption[]>();
  private notifications: ClientRuntimeNotification[] = [];
  private telemetry?: ClientRuntimeStateSnapshot['telemetry'];

  private updateListeners = new Set<UpdateListener>();
  private streamListeners = new Set<StreamListener>();
  private unsubControl: (() => void) | null = null;
  private unsubBinary: (() => void) | null = null;

  constructor(transport: ClientTransport, bufferStore: StreamBufferStore = new TypedArrayRingBufferStore()) {
    this.transport = transport;
    this.bufferStore = bufferStore;
  }

  async connect(): Promise<void> {
    // Подключение ref-counted: один и тот же runtime используется singleton'ом в React,
    // а в dev под StrictMode mount/unmount может происходить дважды.
    this.attachCount += 1;

    if (this.connected) return;
    if (this.connectPromise) {
      await this.connectPromise;
      return;
    }
    if (this.disconnectPromise) {
      await this.disconnectPromise;
      if (this.connected) return;
      if (this.connectPromise) {
        await this.connectPromise;
        return;
      }
    }

    // В dev под React.StrictMode эффект подключения может вызываться повторно до завершения первого `connect()`.
    // Защищаемся от двойной регистрации IPC/WS обработчиков и дублирования binary-событий.
    this.connectPromise = (async () => {
      if (!this.unsubControl) {
        this.unsubControl = this.transport.onControl((message) => this.handleControl(message));
      }
      if (!this.unsubBinary) {
        this.unsubBinary = this.transport.onBinary((buffer) => this.handleBinary(buffer));
      }

      try {
        await this.transport.connect();
        // Если к моменту завершения подключения все подписчики уже отписались,
        // не удерживаем транспорт открытым и сразу откатываемся в отключенное состояние.
        if (this.attachCount <= 0) {
          await this.transport.disconnect();
          this.unsubControl?.();
          this.unsubBinary?.();
          this.unsubControl = null;
          this.unsubBinary = null;
          return;
        }
        this.connected = true;
        this.notifyUpdate();
      } catch (error) {
        // Если подключение не удалось, откатываем подписки, чтобы не оставить "висячие" дубликаты.
        this.unsubControl?.();
        this.unsubBinary?.();
        this.unsubControl = null;
        this.unsubBinary = null;
        throw error;
      }
    })();

    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  async disconnect(): Promise<void> {
    if (this.attachCount > 0) {
      this.attachCount -= 1;
    }
    if (this.attachCount > 0) {
      return;
    }

    if (this.disconnectPromise) {
      await this.disconnectPromise;
      return;
    }

    this.disconnectPromise = (async () => {
      // Если connect еще в процессе, дожидаемся завершения (успех/ошибка),
      // чтобы корректно снять подписки и не оставлять гонки состояния.
      if (this.connectPromise) {
        try {
          await this.connectPromise;
        } catch {
          // Игнорируем: в этом случае ниже просто почистим подписки.
        }
      }

      // Пока ждали завершение `connect()`, кто-то мог снова подписаться.
      // В этом случае отключение отменяем.
      if (this.attachCount > 0) {
        return;
      }

      if (this.connected) {
        await this.transport.disconnect();
      }

      // Если новое подключение пришло во время `transport.disconnect()`,
      // `connect()` дождется `disconnectPromise` и заново поднимет транспорт.
      this.unsubControl?.();
      this.unsubBinary?.();
      this.unsubControl = null;
      this.unsubBinary = null;

      if (this.connected) {
        this.connected = false;
        this.notifyUpdate();
      }
    })();

    try {
      await this.disconnectPromise;
    } finally {
      this.disconnectPromise = null;
    }
  }

  async sendCommand(eventType: string, payload?: Record<string, unknown>): Promise<void> {
    const command = { type: 'ui.command', eventType, correlationId: crypto.randomUUID() } as const;
    if (payload !== undefined) {
      await this.transport.sendCommand({ ...command, payload });
      return;
    }
    await this.transport.sendCommand(command);
  }

  onUpdate(listener: UpdateListener): () => void {
    this.updateListeners.add(listener);
    return () => this.updateListeners.delete(listener);
  }

  onStreamData(listener: StreamListener): () => void {
    this.streamListeners.add(listener);
    return () => this.streamListeners.delete(listener);
  }

  dismissNotification(notificationId: string): void {
    const next = this.notifications.filter((notification) => notification.id !== notificationId);
    if (next.length === this.notifications.length) return;
    this.notifications = next;
    this.notifyUpdate();
  }

  getSnapshot(): ClientRuntimeStateSnapshot {
    const snapshot: ClientRuntimeStateSnapshot = {
      connected: this.connected,
      flags: this.flags,
      streams: [...this.streamsById.values()],
      formOptions: Object.fromEntries(this.formOptionsBySourceId.entries()),
      notifications: [...this.notifications],
    };
    if (this.sessionId !== undefined) snapshot.sessionId = this.sessionId;
    if (this.clock !== undefined) snapshot.clock = this.clock;
    if (this.schema !== undefined) snapshot.schema = this.schema;
    if (this.telemetry !== undefined) snapshot.telemetry = this.telemetry;
    return snapshot;
  }

  getVisibleWindow(streamId: string, rangeMs: number): StreamWindowData {
    return this.bufferStore.getVisibleWindow(streamId, rangeMs, this.latestSessionMs);
  }

  private handleControl(message: UiControlMessage): void {
    if (message.type === 'ui.init') {
      this.sessionId = message.sessionId;
      this.clock = message.clock;
      this.schema = message.schema;
      this.flags = message.flags;
      this.latestSessionMs = 0;
      this.streamsById.clear();
      this.streamsByNumericId.clear();
      this.formOptionsBySourceId.clear();
      this.notifications = [];
      this.bufferStore.clear();
      for (const stream of message.streams) {
        this.registerStream(stream);
      }
      this.notifyUpdate();
      return;
    }

    if (message.type === 'ui.schema.patch') {
      this.schema = message.patch.schema;
      this.notifyUpdate();
      return;
    }

    if (message.type === 'ui.flags.patch') {
      this.flags = { ...this.flags, ...message.patch };
      this.notifyUpdate();
      return;
    }

    if (message.type === 'ui.form.options.patch') {
      this.formOptionsBySourceId.set(message.sourceId, [...message.options]);
      this.notifyUpdate();
      return;
    }

    if (message.type === 'ui.stream.declare') {
      this.registerStream(message.stream);
      this.notifyUpdate();
      return;
    }

    if (message.type === 'ui.telemetry') {
      this.telemetry = message;
      this.notifyUpdate();
      return;
    }

    if (message.type === 'ui.stream.drop') {
      this.streamsById.delete(message.streamId);
      this.notifyUpdate();
      return;
    }

    if (message.type === 'ui.error') {
      // Ошибку сохраняем и как toast-уведомление, и как последний текстовый флаг для status/debug.
      this.notifications = [
        ...this.notifications.slice(-19),
        {
          id: crypto.randomUUID(),
          level: 'error',
          code: message.code,
          message: message.message,
          ...(message.pluginId !== undefined ? { pluginId: message.pluginId } : {}),
          createdAtMs: Date.now(),
        },
      ];
      this.flags = { ...this.flags, lastError: message.message };
      this.notifyUpdate();
    }
  }

  private handleBinary(buffer: ArrayBuffer): void {
    try {
      const frame = decodeUiSignalBatchFrame(buffer);
      const stream = this.streamsByNumericId.get(frame.streamNumericId);
      if (!stream) {
        return;
      }
      this.bufferStore.appendFrame(stream, frame);
      if (frame.sampleCount > 0) {
        const frameLastTime = frame.timestampsMs
          ? frame.timestampsMs[frame.sampleCount - 1]!
          : (frame.t0Ms + frame.dtMs * (frame.sampleCount - 1));
        if (frameLastTime > this.latestSessionMs) {
          this.latestSessionMs = frameLastTime;
        }
      }
      for (const listener of this.streamListeners) {
        listener(stream.streamId);
      }
    } catch (error) {
      console.error('[ClientRuntime] Ошибка декодирования binary frame', error);
    }
  }

  private registerStream(stream: UiStreamDeclaration): void {
    this.streamsById.set(stream.streamId, stream);
    this.streamsByNumericId.set(stream.numericId, stream);
    this.bufferStore.ensureStream(stream);
  }

  private notifyUpdate(): void {
    for (const listener of this.updateListeners) {
      listener();
    }
  }
}
