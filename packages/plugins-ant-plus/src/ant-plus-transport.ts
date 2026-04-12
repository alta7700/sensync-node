import { loadAntPlusApi, type AntEventEmitterLike, type AntPlusApi, type AntPlusStick } from './ant-plus-boundary.ts';

/**
 * Низкоуровневые helpers ANT+ transport boundary.
 *
 * Здесь нет профиля, streamId или decode-логики. Этот слой отвечает только за stick lifecycle
 * и безопасное ожидание событий от драйвера.
 */
export interface AntPlusTransportContext {
  api: AntPlusApi;
}

export function createAntPlusTransportContext(): AntPlusTransportContext {
  return {
    api: loadAntPlusApi(),
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function waitForEmitterEvent(
  emitter: AntEventEmitterLike,
  eventName: string,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let timeoutId: NodeJS.Timeout | null = null;
    const listener = () => {
      if (timeoutId) clearTimeout(timeoutId);
      emitter.removeListener(eventName, listener);
      resolve();
    };

    timeoutId = setTimeout(() => {
      emitter.removeListener(eventName, listener);
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    emitter.on(eventName, listener);
  });
}

export async function closeStickSafely(stick: AntPlusStick | null): Promise<void> {
  if (!stick) return;

  try {
    const shutdownPromise = waitForEmitterEvent(stick, 'shutdown', 1_000, 'ANT+ stick не прислал shutdown');
    stick.close();
    await shutdownPromise.catch(() => undefined);
  } catch {
    // Игнорируем ошибки закрытия: при следующем scan/connect попробуем открыть новый stick.
  }
}
