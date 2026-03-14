// Этот файл сгенерирован `npm run generate:runtime-event-map`.
// Не редактируй его вручную: править нужно *.spec.ts и генератор.

import type { CommandEvent, FactEvent, RuntimeEventMap } from '@sensync2/core';
import type { TrignoCommandRequestPayload, TrignoStatusReportedPayload } from './trigno-boundary.ts';

export type TrignoStreamStartRequestEvent = CommandEvent<TrignoCommandRequestPayload, 'trigno.stream.start.request'> & {
  v: 1;
  kind: 'command';
  priority: 'control';
};

export type TrignoStreamStopRequestEvent = CommandEvent<TrignoCommandRequestPayload, 'trigno.stream.stop.request'> & {
  v: 1;
  kind: 'command';
  priority: 'control';
};

export type TrignoStatusRefreshRequestEvent = CommandEvent<TrignoCommandRequestPayload, 'trigno.status.refresh.request'> & {
  v: 1;
  kind: 'command';
  priority: 'control';
};

export type TrignoStatusReportedEvent = FactEvent<TrignoStatusReportedPayload, 'trigno.status.reported'> & {
  v: 1;
  kind: 'fact';
  priority: 'system';
};

export type TrignoPollEvent = FactEvent<Record<string, never>, 'trigno.poll'> & {
  v: 1;
  kind: 'fact';
  priority: 'system';
};

declare module '@sensync2/core' {
  interface RuntimeEventMap {
    'trigno.stream.start.request@1': TrignoStreamStartRequestEvent;
    'trigno.stream.stop.request@1': TrignoStreamStopRequestEvent;
    'trigno.status.refresh.request@1': TrignoStatusRefreshRequestEvent;
    'trigno.status.reported@1': TrignoStatusReportedEvent;
    'trigno.poll@1': TrignoPollEvent;
  }
}

export {};
