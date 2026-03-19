export interface LatestWinsRunnerConfig<TPayload, TResult> {
  run(payload: TPayload): Promise<TResult>;
  onResult?(result: TResult, payload: TPayload): Promise<void> | void;
  onError?(error: unknown, payload: TPayload): Promise<void> | void;
}

export interface LatestWinsRunner<TPayload> {
  schedule(payload: TPayload): void;
  isBusy(): boolean;
  close(): Promise<void>;
}

export function createLatestWinsRunner<TPayload, TResult>(
  config: LatestWinsRunnerConfig<TPayload, TResult>,
): LatestWinsRunner<TPayload> {
  let inFlight = false;
  let closed = false;
  let pendingPayload: TPayload | null = null;
  let running: Promise<void> | null = null;

  const runSingle = async (payload: TPayload): Promise<void> => {
    try {
      const result = await config.run(payload);
      if (!closed) {
        await config.onResult?.(result, payload);
      }
    } catch (error) {
      if (!closed) {
        await config.onError?.(error, payload);
      }
    }
  };

  const pump = async (payload: TPayload): Promise<void> => {
    inFlight = true;
    let currentPayload: TPayload | null = payload;

    while (currentPayload !== null) {
      await runSingle(currentPayload);

      if (closed) {
        break;
      }

      currentPayload = pendingPayload;
      pendingPayload = null;
    }

    inFlight = false;
    running = null;
  };

  return {
    schedule(payload) {
      if (closed) {
        return;
      }
      if (inFlight) {
        pendingPayload = payload;
        return;
      }
      running = pump(payload);
    },
    isBusy() {
      return inFlight;
    },
    async close() {
      closed = true;
      pendingPayload = null;
      await running?.catch(() => {});
      running = null;
      inFlight = false;
    },
  };
}
