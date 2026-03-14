import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RuntimeHost } from '../apps/runtime/src/runtime-host';
import { createUiCommandMessage, EventTypes, type UiCommandEventType, type UiCommandMessage } from '../packages/core/src/index';

type ControlMessage = { type: string; [key: string]: unknown };

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function repoModuleUrl(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  return pathToFileURL(path.join(repoRoot, relativePathFromRepoRoot)).href;
}

function uiCommand(eventType: UiCommandEventType, payload: Record<string, unknown>): UiCommandMessage {
  return createUiCommandMessage({
    eventType,
    payload,
  });
}

async function recordFixture(outputDir: string): Promise<string> {
  const runtime = new RuntimeHost({
    plugins: [
      {
        id: 'fake-signal-adapter',
        modulePath: repoModuleUrl('packages/plugins-fake/src/fake-signal-adapter.ts'),
        config: {
          sampleRateHz: 200,
          batchMs: 50,
          compareSampleRateHz: 200,
          compareBatchMs: 50,
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
    await runtime.sendUiCommand(uiCommand(
      EventTypes.adapterConnectRequest,
      { adapterId: 'fake', requestId: 'connect-recorder' },
    ), 'smoke');

    await runtime.sendUiCommand(uiCommand(
      EventTypes.recordingStart,
      {
        writer: 'local',
        requestId: 'recording-start',
        filenameTemplate: '{fio}-{startDateTime}',
        metadata: {
          fio: 'FakeHdf5SimulationSmoke',
          profile: 'fake',
        },
        channels: [
          { channelId: 'fake.a1', minSamples: 40, maxBufferedMs: 300 },
          { channelId: 'fake.a2', minSamples: 40, maxBufferedMs: 300 },
          { channelId: 'fake.b', minSamples: 40, maxBufferedMs: 300 },
        ],
      },
    ), 'smoke');

    await wait(400);

    await runtime.sendUiCommand(uiCommand(
      EventTypes.recordingStop,
      { writer: 'local', requestId: 'recording-stop' },
    ), 'smoke');

    await runtime.sendUiCommand(uiCommand(
      EventTypes.adapterDisconnectRequest,
      { adapterId: 'fake', requestId: 'disconnect-recorder' },
    ), 'smoke');
  } finally {
    await runtime.stop();
  }

  const files = readdirSync(outputDir).filter((entry) => entry.endsWith('.h5'));
  assert.equal(files.length, 1, `Ожидался один HDF5 файл, получено ${files.length}`);
  return path.join(outputDir, files[0]!);
}

async function main(): Promise<void> {
  const outputDir = mkdtempSync(path.join(os.tmpdir(), 'sensync2-fake-hdf5-sim-'));
  const filePath = await recordFixture(outputDir);

  const controlMessages: ControlMessage[] = [];
  let binaryFrames = 0;

  const runtime = new RuntimeHost({
    plugins: [
      {
        id: 'hdf5-simulation-adapter',
        modulePath: repoModuleUrl('packages/plugins-hdf5/src/hdf5-simulation-adapter.ts'),
        config: {
          adapterId: 'fake-hdf5-simulation',
          filePath,
          channelIds: ['fake.a1', 'fake.a2', 'fake.b'],
          batchMs: 50,
          speed: 1,
          readChunkSamples: 128,
        },
      },
      {
        id: 'ui-gateway',
        modulePath: repoModuleUrl('packages/plugins-ui-gateway/src/ui-gateway-plugin.ts'),
        config: {
          sessionId: 'smoke-fake-hdf5-simulation',
          profile: 'fake-hdf5-simulation',
        },
      },
    ],
    uiSinks: {
      onControl(payload) {
        controlMessages.push(payload.message as ControlMessage);
      },
      onBinary() {
        binaryFrames += 1;
      },
    },
  });

  await runtime.start();
  try {
    await runtime.attachUiClient('smoke-ui');

    await runtime.sendUiCommand(uiCommand(
      EventTypes.adapterConnectRequest,
      { adapterId: 'fake-hdf5-simulation', requestId: 'sim-connect' },
    ), 'smoke-ui');

    await wait(220);

    await runtime.sendUiCommand(uiCommand(
      EventTypes.simulationPauseRequest,
      { adapterId: 'fake-hdf5-simulation', requestId: 'sim-pause' },
    ), 'smoke-ui');

    await runtime.sendUiCommand(uiCommand(
      EventTypes.simulationSpeedSetRequest,
      { adapterId: 'fake-hdf5-simulation', speed: 2, requestId: 'sim-speed' },
    ), 'smoke-ui');

    await runtime.sendUiCommand(uiCommand(
      EventTypes.simulationResumeRequest,
      { adapterId: 'fake-hdf5-simulation', requestId: 'sim-resume' },
    ), 'smoke-ui');

    await wait(220);

    await runtime.sendUiCommand(uiCommand(
      EventTypes.adapterDisconnectRequest,
      { adapterId: 'fake-hdf5-simulation', requestId: 'sim-disconnect' },
    ), 'smoke-ui');
  } finally {
    await runtime.stop();
  }

  const initMessage = controlMessages.find((message) => message.type === 'ui.init');
  assert(initMessage, 'Ожидалось сообщение ui.init');

  const streamDeclares = controlMessages.filter((message) => message.type === 'ui.stream.declare');
  const declaredStreamIds = new Set(
    streamDeclares
      .map((message) => (message.stream as { streamId?: string } | undefined)?.streamId)
      .filter((value): value is string => typeof value === 'string'),
  );
  assert(declaredStreamIds.has('fake.a1'), 'Ожидался ui.stream.declare для fake.a1');
  assert(declaredStreamIds.has('fake.a2'), 'Ожидался ui.stream.declare для fake.a2');
  assert(declaredStreamIds.has('fake.b'), 'Ожидался ui.stream.declare для fake.b');
  assert(binaryFrames > 0, 'Ожидались binary frames от fake-hdf5-simulation');

  const flagPatches = controlMessages.filter((message) => message.type === 'ui.flags.patch');
  const mergedFlags = Object.assign({}, ...flagPatches.map((message) => message.patch as Record<string, unknown>));
  assert.equal(mergedFlags['simulation.fake-hdf5-simulation.speed'], 2, 'Ожидалось обновление speed до 2x');
  assert.equal(mergedFlags['adapter.fake-hdf5-simulation.state'], 'disconnected', 'Ожидалось штатное отключение simulation');

  console.log(`Fake HDF5 simulation smoke OK: ${filePath}`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
