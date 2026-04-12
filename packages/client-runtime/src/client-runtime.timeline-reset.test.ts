import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  encodeUiSignalBatchFrameFromEvent,
  EventTypes,
  type RuntimeEventOf,
  type UiControlMessage,
} from '@sensync2/core';
import { ClientRuntime } from './client-runtime.ts';

class TestTransport {
  private controlHandler: ((message: UiControlMessage) => void) | null = null;
  private binaryHandler: ((buffer: ArrayBuffer) => void) | null = null;

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  async sendCommand(): Promise<void> {}

  onControl(handler: (message: UiControlMessage) => void): () => void {
    this.controlHandler = handler;
    return () => {
      if (this.controlHandler === handler) {
        this.controlHandler = null;
      }
    };
  }

  onBinary(handler: (buffer: ArrayBuffer) => void): () => void {
    this.binaryHandler = handler;
    return () => {
      if (this.binaryHandler === handler) {
        this.binaryHandler = null;
      }
    };
  }

  emitControl(message: UiControlMessage): void {
    this.controlHandler?.(message);
  }

  emitBinary(buffer: ArrayBuffer): void {
    this.binaryHandler?.(buffer);
  }
}

function makeSignalEvent(
  seq: bigint,
  t0Ms: number,
  values: Float32Array,
): RuntimeEventOf<typeof EventTypes.signalBatch, 1> {
  return {
    seq,
    timelineId: 'timeline-test',
    type: EventTypes.signalBatch,
    v: 1,
    tsMonoMs: t0Ms,
    sourcePluginId: 'runtime',
    kind: 'data',
    priority: 'data',
    payload: {
      streamId: 'fake.a2',
      sampleFormat: 'f32',
      frameKind: 'uniform-signal-batch',
      t0Ms,
      dtMs: 10,
      sampleRateHz: 100,
      sampleCount: values.length,
      values,
      units: 'a.u.',
    },
  };
}

describe('ClientRuntime timeline reset', () => {
  let transport: TestTransport | null = null;
  let runtime: ClientRuntime | null = null;

  afterEach(async () => {
    if (runtime) {
      await runtime.disconnect();
    }
  });

  it('очищает буферы и показывает X относительно timelineStartSessionMs', async () => {
    transport = new TestTransport();
    runtime = new ClientRuntime(transport);
    await runtime.connect();

    transport.emitControl({
      type: 'ui.init',
      sessionId: 'session-test',
      schema: { version: 1, pages: [], widgets: [] },
      streams: [{
        streamId: 'fake.a2',
        numericId: 1,
        label: 'fake.a2',
        sampleFormat: 'f32',
        frameKind: 'uniform-signal-batch',
        sampleRateHz: 100,
      }],
      flags: {},
      clock: {
        timeDomain: 'session',
        sessionStartWallMs: 123,
        timelineId: 'timeline-a',
        timelineStartSessionMs: 0,
      },
    });

    transport.emitBinary(encodeUiSignalBatchFrameFromEvent(
      makeSignalEvent(1n, 100, new Float32Array([1, 2, 3])),
      1,
    ));

    let window = runtime.getVisibleWindow('fake.a2', 1_000);
    expect(Array.from(window.x)).toEqual([100, 110, 120]);

    transport.emitControl({
      type: 'ui.timeline.reset',
      timelineId: 'timeline-b',
      timelineStartSessionMs: 500,
      clearBuffers: true,
    });

    window = runtime.getVisibleWindow('fake.a2', 1_000);
    expect(window.length).toBe(0);
    expect(runtime.getSnapshot().clock).toMatchObject({
      timelineId: 'timeline-b',
      timelineStartSessionMs: 500,
    });

    transport.emitBinary(encodeUiSignalBatchFrameFromEvent(
      makeSignalEvent(2n, 550, new Float32Array([4, 5])),
      1,
    ));

    window = runtime.getVisibleWindow('fake.a2', 1_000);
    expect(Array.from(window.x)).toEqual([50, 60]);
    expect(Array.from(window.y)).toEqual([4, 5]);
  });

  it('пишет диагностический лог при применении recording flag patch и timeline reset', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      transport = new TestTransport();
      runtime = new ClientRuntime(transport);
      await runtime.connect();

      transport.emitControl({
        type: 'ui.init',
        sessionId: 'session-test',
        schema: { version: 1, pages: [], widgets: [] },
        streams: [],
        flags: {},
        clock: {
          timeDomain: 'session',
          sessionStartWallMs: 123,
          timelineId: 'timeline-a',
          timelineStartSessionMs: 0,
        },
      });

      transport.emitControl({
        type: 'ui.flags.patch',
        patch: {
          'recording.hdf5-recorder.state': 'stopping',
          'recording.hdf5-recorder.filePath': '/tmp/veloerg.h5',
          'recording.hdf5-recorder.message': 'Закрытие файла...',
        },
        version: 12,
      });

      expect(logSpy).toHaveBeenCalledWith(
        '[ClientRuntime] ui.flags.patch (recording)',
        expect.objectContaining({
          version: 12,
          patch: expect.objectContaining({
            'recording.hdf5-recorder.state': 'stopping',
          }),
          recording: expect.objectContaining({
            'recording.hdf5-recorder.state': 'stopping',
            'recording.hdf5-recorder.filePath': '/tmp/veloerg.h5',
            'recording.hdf5-recorder.message': 'Закрытие файла...',
          }),
        }),
      );

      transport.emitControl({
        type: 'ui.timeline.reset',
        timelineId: 'timeline-b',
        timelineStartSessionMs: 500,
        clearBuffers: true,
      });

      expect(logSpy).toHaveBeenCalledWith(
        '[ClientRuntime] ui.timeline.reset',
        expect.objectContaining({
          timelineId: 'timeline-b',
          timelineStartSessionMs: 500,
          clearBuffers: true,
        }),
      );
    } finally {
      logSpy.mockRestore();
    }
  });
});
