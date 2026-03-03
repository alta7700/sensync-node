export interface SessionClockSnapshot {
  sessionStartMonoNs: bigint;
  sessionStartWallMs: number;
}

/**
 * Единый источник времени сессии для runtime и всех plugin worker'ов.
 *
 * Основа вычислений:
 * - monotonic clock (`process.hrtime.bigint`) для стабильного elapsed времени;
 * - wall-clock только как метаданные старта (экспорт/логирование).
 */
export class SessionClock {
  private readonly startMonoNs: bigint;
  private readonly startWallMs: number;

  constructor(startMonoNs = process.hrtime.bigint(), startWallMs = Date.now()) {
    this.startMonoNs = startMonoNs;
    this.startWallMs = startWallMs;
  }

  nowSessionMs(): number {
    const deltaNs = process.hrtime.bigint() - this.startMonoNs;
    return Number(deltaNs) / 1_000_000;
  }

  snapshot(): SessionClockSnapshot {
    return {
      sessionStartMonoNs: this.startMonoNs,
      sessionStartWallMs: this.startWallMs,
    };
  }
}

