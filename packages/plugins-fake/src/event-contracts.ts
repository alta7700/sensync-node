import { defineEventContract } from '@sensync2/core';

export const FakePluginEventContracts = {
  fakeSchedulerTick: defineEventContract({
    type: 'fake.scheduler.tick',
    v: 1,
    kind: 'fact',
    priority: 'system',
    visibility: 'plugin-private',
    description: 'Внутренний тик fake-генератора сигналов.',
  }),
  shapeSchedulerTick: defineEventContract({
    type: 'shape.scheduler.tick',
    v: 1,
    kind: 'fact',
    priority: 'system',
    visibility: 'plugin-private',
    description: 'Внутренний тик генератора форм.',
  }),
  rollingMinFlush: defineEventContract({
    type: 'processor.rolling-min.flush',
    v: 1,
    kind: 'fact',
    priority: 'system',
    visibility: 'plugin-private',
    description: 'Внутренний таймер flush для rolling-min процессора.',
  }),
  metricValueChanged: defineEventContract({
    type: 'metric.value.changed',
    v: 1,
    kind: 'fact',
    priority: 'system',
    visibility: 'plugin-private',
    description: 'Плагин-специфичное изменение вычисленной метрики.',
  }),
} as const;

export const fakeEventContracts = Object.values(FakePluginEventContracts);
