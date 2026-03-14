// Этот файл сгенерирован `npm run generate:runtime-event-map`.
// Не редактируй его вручную: править нужно *.spec.ts и генератор.

import type { FactEvent, RuntimeEventMap } from '@sensync2/core';

export type FakeSchedulerTickEvent = FactEvent<Record<string, never>, 'fake.scheduler.tick'> & {
  v: 1;
  kind: 'fact';
  priority: 'system';
};

export type ShapeSchedulerTickEvent = FactEvent<Record<string, never>, 'shape.scheduler.tick'> & {
  v: 1;
  kind: 'fact';
  priority: 'system';
};

export type RollingMinFlushEvent = FactEvent<Record<string, never>, 'processor.rolling-min.flush'> & {
  v: 1;
  kind: 'fact';
  priority: 'system';
};

export type MetricValueChangedEvent = FactEvent<{ key: string; value: number }, 'metric.value.changed'> & {
  v: 1;
  kind: 'fact';
  priority: 'system';
};

declare module '@sensync2/core' {
  interface RuntimeEventMap {
    'fake.scheduler.tick@1': FakeSchedulerTickEvent;
    'shape.scheduler.tick@1': ShapeSchedulerTickEvent;
    'processor.rolling-min.flush@1': RollingMinFlushEvent;
    'metric.value.changed@1': MetricValueChangedEvent;
  }
}

export {};
