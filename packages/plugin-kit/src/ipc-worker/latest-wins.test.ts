import { describe, expect, it } from 'vitest';
import { createLatestWinsRunner } from './latest-wins.ts';

describe('createLatestWinsRunner', () => {
  it('не копит очередь и оставляет только последний pending payload', async () => {
    const started: number[] = [];
    const completed: number[] = [];
    let resolveCurrent: (() => void) | null = null;

    const runner = createLatestWinsRunner<number, number>({
      async run(payload) {
        started.push(payload);
        await new Promise<void>((resolve) => {
          resolveCurrent = resolve;
        });
        return payload;
      },
      onResult(result) {
        completed.push(result);
      },
    });

    runner.schedule(1);
    runner.schedule(2);
    runner.schedule(3);
    expect(started).toEqual([1]);

    if (!resolveCurrent) {
      throw new Error('Ожидался активный in-flight run');
    }
    const firstResolve = resolveCurrent as () => void;
    firstResolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual([1, 3]);

    if (!resolveCurrent) {
      throw new Error('Ожидался второй in-flight run');
    }
    const secondResolve = resolveCurrent as () => void;
    secondResolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(completed).toEqual([1, 3]);
    await runner.close();
  });
});
