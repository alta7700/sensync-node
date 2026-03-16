import { afterEach, describe, expect, it } from 'vitest';
import { createUiCommandMessage, EventTypes, type UiControlOutPayload } from '@sensync2/core';
import { buildLaunchProfile } from './profiles/index.ts';
import { RuntimeHost } from './runtime-host.ts';

describe('RuntimeHost timeline reset', () => {
  let runtime: RuntimeHost | null = null;

  afterEach(async () => {
    if (!runtime) {
      return;
    }
    await runtime.stop();
    runtime = null;
  });

  it('держит attach в pending во время reset и выпускает его после commit', async () => {
    const controls: Array<{ payload: UiControlOutPayload; atMs: number }> = [];

    runtime = new RuntimeHost({
      plugins: [
        {
          id: 'runtime-reset-probe-plugin',
          modulePath: new URL('./runtime-reset-probe-plugin.test-fixture.ts', import.meta.url).href,
          config: {
            prepareDelayMs: 20,
            commitDelayMs: 40,
          },
        },
      ],
      timelineReset: {
        enabled: true,
        requesters: ['external-ui'],
        participants: ['runtime-reset-probe-plugin'],
        prepareTimeoutMs: 1_000,
        commitTimeoutMs: 1_000,
        recorderPolicy: 'reject-if-recording',
      },
      uiSinks: {
        onControl(payload) {
          controls.push({ payload, atMs: Date.now() });
        },
      },
    });

    await runtime.start();
    await runtime.attachUiClient('before-reset');
    await waitFor(() => controls.some((entry) => entry.payload.clientId === 'before-reset'));

    const resetPromise = runtime.sendUiCommand(createUiCommandMessage({
      eventType: EventTypes.timelineResetRequest,
      payload: { reason: 'test-reset' },
    }), 'client-1');

    // Пока reset не завершён, новый клиент не должен получить промежуточный snapshot/control.
    await runtime.attachUiClient('pending-client');
    await delay(10);
    expect(controls.some((entry) => entry.payload.clientId === 'pending-client')).toBe(false);

    await resetPromise;
    await waitFor(() => controls.some((entry) => entry.payload.message.type === 'ui.warning' && entry.payload.message.code === 'reset_commit_probe'));
    await waitFor(() => controls.some((entry) => entry.payload.clientId === 'pending-client'));

    const commitIndex = controls.findIndex((entry) => {
      return entry.payload.message.type === 'ui.warning' && entry.payload.message.code === 'reset_commit_probe';
    });
    const attachIndex = controls.findIndex((entry) => entry.payload.clientId === 'pending-client');

    expect(commitIndex).toBeGreaterThanOrEqual(0);
    expect(attachIndex).toBeGreaterThan(commitIndex);
  });

  it('не теряет fast-path reset и после commit сохраняет label-generator на новом timeline', async () => {
    const controls: UiControlOutPayload[] = [];
    const profile = buildLaunchProfile('fake');
    if (!profile.timelineReset) {
      throw new Error('Ожидался timelineReset в fake-профиле');
    }

    runtime = new RuntimeHost({
      plugins: profile.plugins,
      timelineReset: profile.timelineReset,
      uiSinks: {
        onControl(payload) {
          controls.push(payload);
        },
      },
    });

    await runtime.start();
    await runtime.attachUiClient('fake-ui');
    await waitFor(() => controls.some((entry) => entry.message.type === 'ui.init'));

    controls.length = 0;
    await runtime.sendUiCommand(createUiCommandMessage({
      eventType: EventTypes.timelineResetRequest,
      payload: { reason: 'test-fast-reset' },
    }), 'fake-ui');

    await waitFor(() => {
      return controls.some((entry) => entry.message.type === 'ui.timeline.reset');
    }, 5_000);

    controls.length = 0;
    await runtime.sendUiCommand(createUiCommandMessage({
      eventType: EventTypes.labelMarkRequest,
      payload: { labelId: 'interval', value: 1 },
    }), 'fake-ui');

    await waitFor(() => {
      return controls.some((entry) => {
        return entry.message.type === 'ui.flags.patch' && entry.message.patch['interval.active'] === true;
      });
    }, 5_000);
  });

  it('не публикует buffered success-события наружу при commit-failure', async () => {
    const controls: UiControlOutPayload[] = [];

    runtime = new RuntimeHost({
      plugins: [
        {
          id: 'runtime-reset-probe-plugin',
          modulePath: new URL('./runtime-reset-probe-plugin.test-fixture.ts', import.meta.url).href,
          config: {
            emitBeforeFailOnCommit: true,
            failCommit: true,
          },
        },
      ],
      timelineReset: {
        enabled: true,
        requesters: ['external-ui'],
        participants: ['runtime-reset-probe-plugin'],
        prepareTimeoutMs: 1_000,
        commitTimeoutMs: 1_000,
        recorderPolicy: 'reject-if-recording',
      },
      uiSinks: {
        onControl(payload) {
          controls.push(payload);
        },
      },
    });

    await runtime.start();
    await runtime.sendUiCommand(createUiCommandMessage({
      eventType: EventTypes.timelineResetRequest,
      payload: { reason: 'test-commit-failure' },
    }), 'client-1');

    await waitFor(() => {
      return controls.some((entry) => {
        return entry.message.type === 'ui.error' && entry.message.code === 'timeline_reset_commit_failed';
      });
    });

    expect(controls.some((entry) => {
      return entry.message.type === 'ui.warning' && entry.message.code === 'reset_commit_probe';
    })).toBe(false);
  });

  it('возвращает requester-result rejected при раннем отклонении reset-запроса от плагина', async () => {
    const controls: UiControlOutPayload[] = [];

    runtime = new RuntimeHost({
      plugins: [
        {
          id: 'runtime-reset-requester-plugin',
          modulePath: new URL('./runtime-reset-requester-plugin.test-fixture.ts', import.meta.url).href,
          config: {
            triggerClientId: 'requester-ui',
          },
        },
      ],
      timelineReset: {
        enabled: true,
        requesters: ['external-ui'],
        participants: [],
        prepareTimeoutMs: 1_000,
        commitTimeoutMs: 1_000,
        recorderPolicy: 'reject-if-recording',
      },
      uiSinks: {
        onControl(payload) {
          controls.push(payload);
        },
      },
    });

    await runtime.start();
    await runtime.attachUiClient('requester-ui');

    await waitFor(() => {
      return controls.some((entry) => {
        return entry.message.type === 'ui.warning' && entry.message.code === 'reset_request_result_rejected';
      });
    });

    expect(controls.some((entry) => {
      return entry.message.type === 'ui.warning' && entry.message.code === 'reset_request_result_succeeded';
    })).toBe(false);
  });

  it('шлёт requester-result succeeded только после глобального finish reset', async () => {
    const controls: Array<{ payload: UiControlOutPayload; atMs: number }> = [];

    runtime = new RuntimeHost({
      plugins: [
        {
          id: 'runtime-reset-requester-plugin',
          modulePath: new URL('./runtime-reset-requester-plugin.test-fixture.ts', import.meta.url).href,
          config: {
            triggerClientId: 'requester-ui',
          },
        },
        {
          id: 'runtime-reset-probe-plugin',
          modulePath: new URL('./runtime-reset-probe-plugin.test-fixture.ts', import.meta.url).href,
          config: {
            commitDelayMs: 30,
          },
        },
      ],
      timelineReset: {
        enabled: true,
        requesters: ['runtime-reset-requester-plugin'],
        participants: ['runtime-reset-probe-plugin'],
        prepareTimeoutMs: 1_000,
        commitTimeoutMs: 1_000,
        recorderPolicy: 'reject-if-recording',
      },
      uiSinks: {
        onControl(payload) {
          controls.push({ payload, atMs: Date.now() });
        },
      },
    });

    await runtime.start();
    await runtime.attachUiClient('requester-ui');

    await waitFor(() => {
      return controls.some((entry) => {
        return entry.payload.message.type === 'ui.warning' && entry.payload.message.code === 'reset_request_result_succeeded';
      });
    });

    const commitIndex = controls.findIndex((entry) => {
      return entry.payload.message.type === 'ui.warning' && entry.payload.message.code === 'reset_commit_probe';
    });
    const resultIndex = controls.findIndex((entry) => {
      return entry.payload.message.type === 'ui.warning' && entry.payload.message.code === 'reset_request_result_succeeded';
    });

    expect(commitIndex).toBeGreaterThanOrEqual(0);
    expect(resultIndex).toBeGreaterThan(commitIndex);
  });

  it('при global commit-failure requester получает failed вместо success', async () => {
    const controls: UiControlOutPayload[] = [];

    runtime = new RuntimeHost({
      plugins: [
        {
          id: 'runtime-reset-requester-plugin',
          modulePath: new URL('./runtime-reset-requester-plugin.test-fixture.ts', import.meta.url).href,
          config: {
            triggerClientId: 'requester-ui',
          },
        },
        {
          id: 'runtime-reset-probe-plugin',
          modulePath: new URL('./runtime-reset-probe-plugin.test-fixture.ts', import.meta.url).href,
          config: {
            failCommit: true,
          },
        },
      ],
      timelineReset: {
        enabled: true,
        requesters: ['runtime-reset-requester-plugin'],
        participants: ['runtime-reset-probe-plugin'],
        prepareTimeoutMs: 1_000,
        commitTimeoutMs: 1_000,
        recorderPolicy: 'reject-if-recording',
      },
      uiSinks: {
        onControl(payload) {
          controls.push(payload);
        },
      },
    });

    await runtime.start();
    await runtime.attachUiClient('requester-ui');

    await waitFor(() => {
      return controls.some((entry) => {
        return entry.message.type === 'ui.warning' && entry.message.code === 'reset_request_result_failed';
      });
    });

    expect(controls.some((entry) => {
      return entry.message.type === 'ui.warning' && entry.message.code === 'reset_request_result_succeeded';
    })).toBe(false);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if ((Date.now() - startedAt) >= timeoutMs) {
      throw new Error('Условие не выполнилось за отведённое время');
    }
    await delay(10);
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
