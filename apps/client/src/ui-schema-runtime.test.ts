import { describe, expect, it } from 'vitest';
import type { UiModalForm } from '@sensync2/core';
import {
  buildModalInitialValues,
  buildModalSubmitPayload,
  parseTimelineRelativeTime,
  resolveControlPayload,
} from './ui-schema-runtime.ts';

describe('ui-schema-runtime', () => {
  it('парсит timeline-время в формате mm:ss', () => {
    expect(parseTimelineRelativeTime('2:45')).toEqual({
      ok: true,
      relativeMs: 165_000,
    });
  });

  it('собирает submit payload с полями в top-level payload', () => {
    const form: UiModalForm = {
      id: 'mark-lactate',
      title: 'Lactate',
      submitEventType: 'label.mark.request',
      submitPayload: {
        labelId: 'lactate',
      },
      fields: [
        {
          kind: 'timelineTimeInput',
          fieldId: 'atTimeMs',
          label: 'Время',
          required: true,
          submitTarget: 'payload',
        },
        {
          kind: 'decimalInput',
          fieldId: 'value',
          label: 'Лактат',
          required: true,
          submitTarget: 'payload',
        },
      ],
    };

    const built = buildModalSubmitPayload(
      form,
      {
        atTimeMs: '2:45',
        value: '4.2',
      },
      {},
      {
        timeDomain: 'session',
        sessionStartWallMs: 1_700_000_000_000,
        timelineId: 'timeline-1',
        timelineStartSessionMs: 10_000,
      },
    );

    expect(built).toEqual({
      ok: true,
      payload: {
        labelId: 'lactate',
        atTimeMs: 175_000,
        value: 4.2,
      },
    });
  });

  it('инициализирует timeline-time поле строкой по умолчанию', () => {
    const form: UiModalForm = {
      id: 'mark-lactate',
      title: 'Lactate',
      submitEventType: 'label.mark.request',
      fields: [
        {
          kind: 'timelineTimeInput',
          fieldId: 'atTimeMs',
          label: 'Время',
          defaultValue: '0:00',
        },
      ],
    };

    expect(buildModalInitialValues(form)).toEqual({
      atTimeMs: '0:00',
    });
  });

  it('собирает динамический payload для power от последнего значения во flag', () => {
    expect(resolveControlPayload(
      { labelId: 'power' },
      [
        {
          kind: 'number-from-flag',
          payloadKey: 'value',
          flagKey: 'power.current',
          fallbackValue: 0,
          add: 30,
          min: 0,
          round: 'integer',
        },
      ],
      { 'power.current': 185 },
    )).toEqual({
      labelId: 'power',
      value: 215,
    });
  });
});
