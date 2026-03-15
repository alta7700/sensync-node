import { describe, expect, it } from 'vitest';
import { fakeRuntimeEventMapSpec } from './runtime-event-map.spec.ts';

describe('fakeRuntimeEventMapSpec', () => {
  it('описывает внутренние события fake-пакета', () => {
    expect(fakeRuntimeEventMapSpec.entries.map((entry) => entry.alias)).toEqual([
      'FakeSchedulerTickEvent',
      'ShapeSchedulerTickEvent',
      'RollingMinFlushEvent',
      'MetricValueChangedEvent',
    ]);
  });
});
