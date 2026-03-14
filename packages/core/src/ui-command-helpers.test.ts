import { describe, expect, it } from 'vitest';
import { EventTypes } from './event-types.ts';
import { createUiCommandMessage, uiCommandMessageToRuntimeEventInput } from './ui.ts';

describe('UI command helpers', () => {
  it('создает exact UiCommandMessage с дефолтной версией', () => {
    const message = createUiCommandMessage({
      eventType: EventTypes.recordingPause,
      payload: {
        writer: 'local',
        requestId: 'pause-1',
      },
      correlationId: 'corr-1',
    });

    expect(message).toEqual({
      type: 'ui.command',
      eventType: EventTypes.recordingPause,
      eventVersion: 1,
      payload: {
        writer: 'local',
        requestId: 'pause-1',
      },
      correlationId: 'corr-1',
    });
  });

  it('переводит UiCommandMessage во внутренний RuntimeEventInput', () => {
    const message = createUiCommandMessage({
      eventType: EventTypes.recordingPause,
      payload: {
        writer: 'local',
        requestId: 'pause-2',
      },
      correlationId: 'corr-2',
    });

    const event = uiCommandMessageToRuntimeEventInput(message);

    expect(event).toEqual({
      type: EventTypes.recordingPause,
      v: 1,
      kind: 'command',
      priority: 'control',
      payload: {
        writer: 'local',
        requestId: 'pause-2',
      },
      correlationId: 'corr-2',
    });
  });
});
