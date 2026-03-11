import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import h5wasm from 'h5wasm/node';
import { RuntimeHost } from '../apps/runtime/src/runtime-host.ts';
import { EventTypes } from '../packages/core/src/event-types.ts';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function repoModuleUrl(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  return pathToFileURL(path.join(repoRoot, relativePathFromRepoRoot)).href;
}

function assertMonotonic(values: Float64Array, label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index]! < values[index - 1]!) {
      throw new Error(`${label}: timestamps не монотонны на индексе ${index}`);
    }
  }
}

async function main(): Promise<void> {
  const outputDir = mkdtempSync(path.join(os.tmpdir(), 'sensync2-hdf5-'));

  const runtime = new RuntimeHost({
    plugins: [
      {
        id: 'fake-signal-adapter',
        modulePath: repoModuleUrl('packages/plugins-fake/src/fake-signal-adapter.ts'),
        config: {
          sampleRateHz: 200,
          batchMs: 50,
        },
      },
      {
        id: 'hdf5-recorder',
        modulePath: repoModuleUrl('packages/plugins-hdf5/src/hdf5-recorder-plugin.ts'),
        config: {
          writerKey: 'local',
          outputDir,
        },
      },
    ],
  });

  await runtime.start();

  try {
    await runtime.sendUiCommand({
      eventType: EventTypes.adapterConnectRequest,
      payload: {
        adapterId: 'fake',
        requestId: 'connect-1',
      },
    }, 'smoke');

    await runtime.sendUiCommand({
      eventType: EventTypes.recordingStart,
      payload: {
        writer: 'local',
        requestId: 'recording-1',
        filenameTemplate: '{fio}-{startDateTime}',
        metadata: {
          fio: 'SmokeTest',
          protocol: 'fake',
          attempt: 1,
        },
        channels: [
          { channelId: 'fake.a1', minSamples: 40, maxBufferedMs: 300 },
          { channelId: 'fake.b', minSamples: 40, maxBufferedMs: 300 },
        ],
      },
    }, 'smoke');

    await wait(400);

    await runtime.sendUiCommand({
      eventType: EventTypes.recordingPause,
      payload: {
        writer: 'local',
        requestId: 'pause-1',
      },
    }, 'smoke');

    await wait(200);

    await runtime.sendUiCommand({
      eventType: EventTypes.recordingResume,
      payload: {
        writer: 'local',
        requestId: 'resume-1',
      },
    }, 'smoke');

    await wait(400);

    await runtime.sendUiCommand({
      eventType: EventTypes.recordingStop,
      payload: {
        writer: 'local',
        requestId: 'stop-1',
      },
    }, 'smoke');

    await runtime.sendUiCommand({
      eventType: EventTypes.adapterDisconnectRequest,
      payload: {
        adapterId: 'fake',
        requestId: 'disconnect-1',
      },
    }, 'smoke');
  } finally {
    await runtime.stop();
  }

  const files = readdirSync(outputDir).filter((entry) => entry.endsWith('.h5'));
  assert.equal(files.length, 1, `Ожидался один HDF5 файл, получено ${files.length}`);
  const filePath = path.join(outputDir, files[0]!);

  await h5wasm.ready;
  const file = new h5wasm.File(filePath, 'r');
  try {
    const channels = file.get('channels');
    assert(channels instanceof h5wasm.Group, 'Группа /channels не найдена');

    const fakeA1 = channels.get('fake.a1');
    const fakeB = channels.get('fake.b');
    assert(fakeA1 instanceof h5wasm.Group, 'Группа fake.a1 не найдена');
    assert(fakeB instanceof h5wasm.Group, 'Группа fake.b не найдена');

    const a1Timestamps = fakeA1.get('timestamps');
    const a1Values = fakeA1.get('values');
    const bTimestamps = fakeB.get('timestamps');
    const bValues = fakeB.get('values');

    assert(a1Timestamps instanceof h5wasm.Dataset, 'Dataset fake.a1/timestamps не найден');
    assert(a1Values instanceof h5wasm.Dataset, 'Dataset fake.a1/values не найден');
    assert(bTimestamps instanceof h5wasm.Dataset, 'Dataset fake.b/timestamps не найден');
    assert(bValues instanceof h5wasm.Dataset, 'Dataset fake.b/values не найден');

    const a1TimestampsValue = a1Timestamps.value;
    const a1ValuesValue = a1Values.value;
    const bTimestampsValue = bTimestamps.value;
    const bValuesValue = bValues.value;

    assert(a1TimestampsValue instanceof Float64Array, 'fake.a1/timestamps должен быть Float64Array');
    assert(a1ValuesValue instanceof Float32Array, 'fake.a1/values должен быть Float32Array');
    assert(bTimestampsValue instanceof Float64Array, 'fake.b/timestamps должен быть Float64Array');
    assert(bValuesValue instanceof Float32Array, 'fake.b/values должен быть Float32Array');

    assert(a1TimestampsValue.length > 0, 'fake.a1/timestamps пуст');
    assert.equal(a1TimestampsValue.length, a1ValuesValue.length, 'fake.a1 timestamps/values mismatch');
    assert.equal(bTimestampsValue.length, bValuesValue.length, 'fake.b timestamps/values mismatch');

    assertMonotonic(a1TimestampsValue, 'fake.a1');
    assertMonotonic(bTimestampsValue, 'fake.b');
  } finally {
    file.close();
  }

  console.log(`HDF5 smoke OK: ${filePath}`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
