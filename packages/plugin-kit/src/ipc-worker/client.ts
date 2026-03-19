import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { encodeFrame, createFrameDecoder } from './framing.ts';
import {
  createRequestEnvelope,
  createShutdownEnvelope,
  decodeTransportEnvelope,
  encodeTransportEnvelope,
} from './transport-codec.ts';
import type { IpcWorkerClient, IpcWorkerProcessSpec, IpcWorkerRequestOptions } from './types.ts';

interface PendingRequest {
  requestId: string;
  reject(error: Error): void;
  resolve(payload: Uint8Array): void;
  timer: NodeJS.Timeout;
}

function buildWorkerError(spec: IpcWorkerProcessSpec, message: string): Error {
  const workerName = spec.workerName ?? spec.command;
  return new Error(`[ipc-worker:${workerName}] ${message}`);
}

export function createIpcWorkerClient(spec: IpcWorkerProcessSpec): IpcWorkerClient {
  const expectedProtocolVersion = spec.expectedProtocolVersion ?? 1;
  const readyTimeoutMs = spec.readyTimeoutMs ?? 5_000;
  const requestTimeoutMs = spec.requestTimeoutMs ?? 5_000;
  const shutdownTimeoutMs = spec.shutdownTimeoutMs ?? 2_000;

  let child: ChildProcessWithoutNullStreams | null = null;
  const decoder = createFrameDecoder();
  let readyPromise: Promise<void> | null = null;
  let readyResolve: (() => void) | null = null;
  let readyReject: ((error: Error) => void) | null = null;
  let readyMethods = new Set<string>();
  let expectedExit = false;
  let lastStderr = '';
  let pendingRequest: PendingRequest | null = null;

  const cleanupChild = (): void => {
    decoder.reset();
    child = null;
    readyPromise = null;
    readyResolve = null;
    readyReject = null;
    readyMethods = new Set();
  };

  const rejectPending = (error: Error): void => {
    if (!pendingRequest) {
      return;
    }
    clearTimeout(pendingRequest.timer);
    pendingRequest.reject(error);
    pendingRequest = null;
  };

  const handleExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    const stderrSuffix = lastStderr.trim().length > 0 ? ` stderr=${lastStderr.trim()}` : '';
    const error = buildWorkerError(
      spec,
      `процесс завершился code=${String(code)} signal=${String(signal)}.${stderrSuffix}`,
    );
    if (!expectedExit) {
      readyReject?.(error);
      rejectPending(error);
    }
    cleanupChild();
    expectedExit = false;
    lastStderr = '';
  };

  const ensureStarted = async (): Promise<void> => {
    if (readyPromise) {
      return readyPromise;
    }

    readyPromise = new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });

    expectedExit = false;
    lastStderr = '';
    child = spawn(spec.command, spec.args ?? [], {
      cwd: spec.cwd,
      env: {
        ...process.env,
        ...spec.env,
      },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const readyTimer = setTimeout(() => {
      readyReject?.(buildWorkerError(spec, `таймаут ready handshake после ${readyTimeoutMs}мс`));
      void close();
    }, readyTimeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      const frames = decoder.push(chunk);
      for (const frame of frames) {
        const envelope = decodeTransportEnvelope(frame);
        const payload = envelope.payload;
        if (!payload) {
          continue;
        }
        if (payload.$case === 'ready') {
          clearTimeout(readyTimer);
          if (payload.ready.protocolVersion !== expectedProtocolVersion) {
            readyReject?.(buildWorkerError(
              spec,
              `несовместимая версия протокола: expected=${expectedProtocolVersion}, actual=${payload.ready.protocolVersion}, workerVersion=${payload.ready.workerVersion}`,
            ));
            void close();
            return;
          }
          readyMethods = new Set(payload.ready.methods);
          readyResolve?.();
          continue;
        }
        if (payload.$case === 'response') {
          if (!pendingRequest || pendingRequest.requestId !== payload.response.requestId) {
            continue;
          }
          const currentPending = pendingRequest;
          pendingRequest = null;
          clearTimeout(currentPending.timer);
          if (payload.response.ok) {
            currentPending.resolve(payload.response.payload);
            continue;
          }
          currentPending.reject(buildWorkerError(
            spec,
            `${payload.response.error?.code ?? 'worker_error'}: ${payload.response.error?.message ?? 'unknown'}`,
          ));
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      lastStderr += chunk.toString('utf8');
      if (lastStderr.length > 4_096) {
        lastStderr = lastStderr.slice(-4_096);
      }
    });

    child.once('error', (error) => {
      clearTimeout(readyTimer);
      readyReject?.(buildWorkerError(spec, `ошибка запуска: ${error.message}`));
      cleanupChild();
    });

    child.once('exit', handleExit);

    return readyPromise;
  };

  const close = async (): Promise<void> => {
    expectedExit = true;
    const currentChild = child;
    if (!currentChild) {
      cleanupChild();
      return;
    }

    rejectPending(buildWorkerError(spec, 'IPC worker был закрыт до завершения запроса'));

    try {
      currentChild.stdin.write(Buffer.from(encodeFrame(encodeTransportEnvelope(createShutdownEnvelope()))));
    } catch {
      currentChild.kill();
    }

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        currentChild.kill('SIGKILL');
        resolve();
      }, shutdownTimeoutMs);

      currentChild.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    cleanupChild();
    expectedExit = false;
  };

  return {
    async start() {
      await ensureStarted();
    },
    async request(method: string, payload: Uint8Array, options?: IpcWorkerRequestOptions): Promise<Uint8Array> {
      await ensureStarted();
      if (!readyMethods.has(method)) {
        throw buildWorkerError(spec, `worker не объявил метод ${method}`);
      }
      if (pendingRequest) {
        throw buildWorkerError(spec, 'worker уже занят другим запросом');
      }
      if (!child) {
        throw buildWorkerError(spec, 'worker не запущен');
      }
      const currentChild = child;

      const requestId = randomUUID();
      const timeoutMs = options?.timeoutMs ?? requestTimeoutMs;

      return new Promise<Uint8Array>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (pendingRequest?.requestId !== requestId) {
            return;
          }
          pendingRequest = null;
          reject(buildWorkerError(spec, `таймаут ответа на метод ${method} после ${timeoutMs}мс`));
        }, timeoutMs);

        pendingRequest = {
          requestId,
          resolve,
          reject,
          timer,
        };

        try {
          const message = createRequestEnvelope({
            requestId,
            method,
            payload,
          });
          currentChild.stdin.write(Buffer.from(encodeFrame(encodeTransportEnvelope(message))));
        } catch (error) {
          clearTimeout(timer);
          pendingRequest = null;
          reject(buildWorkerError(spec, `не удалось отправить запрос: ${(error as Error).message}`));
        }
      });
    },
    async close() {
      await close();
    },
    isBusy() {
      return pendingRequest !== null;
    },
    readyMethods() {
      return [...readyMethods];
    },
  };
}
