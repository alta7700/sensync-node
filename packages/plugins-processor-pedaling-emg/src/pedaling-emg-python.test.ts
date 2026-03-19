import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createIpcWorkerClient, type IpcWorkerClient, type IpcWorkerProcessSpec } from '@sensync2/plugin-kit';
import { decodePedalingEmgResponse, encodePedalingEmgRequest } from './pedaling-emg-codec.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function createComputeWorkerSpec(): IpcWorkerProcessSpec {
  return {
    command: 'uv',
    args: [
      'run',
      '--project',
      path.join(repoRoot, 'packages/plugin-kit/python-runtime'),
      'python',
      path.join(repoRoot, 'packages/plugins-processor-pedaling-emg/python_worker/main.py'),
    ],
    cwd: repoRoot,
    env: {
      PYTHONUNBUFFERED: '1',
    },
    workerName: 'pedaling-emg-worker',
    readyTimeoutMs: 10_000,
    requestTimeoutMs: 15_000,
  };
}

let client: IpcWorkerClient | null = null;

afterEach(async () => {
  await client?.close();
  client = null;
});

describe('pedaling-emg python worker', () => {
  it('находит activation segment внутри ожидаемого окна', async () => {
    client = createIpcWorkerClient(createComputeWorkerSpec());
    await client.start();

    const sampleRateHz = 1_000;
    const values = new Float32Array(800);
    for (let index = 0; index < values.length; index += 1) {
      const timeMs = index;
      const inBurst = timeMs >= 240 && timeMs <= 430;
      values[index] = inBurst
        ? Math.sin((2 * Math.PI * 85 * timeMs) / 1000) * 0.4
        : Math.sin((2 * Math.PI * 12 * timeMs) / 1000) * 0.01;
    }

    const responsePayload = await client.request('pedaling.emg.detect', encodePedalingEmgRequest({
      cycleId: 1,
      windowStartSessionMs: 1_000,
      sampleRateHz,
      values,
      expectedActiveStartOffsetMs: 200,
      expectedActiveEndOffsetMs: 500,
    }));
    const response = decodePedalingEmgResponse(responsePayload);

    expect(response.status).toBe('ok');
    expect(response.confidence).toBeGreaterThan(0.2);
    expect(response.detectedOnsetOffsetMs).not.toBeNull();
    expect(response.detectedOffsetOffsetMs).not.toBeNull();
    expect(response.detectedOnsetOffsetMs!).toBeGreaterThan(180);
    expect(response.detectedOnsetOffsetMs!).toBeLessThan(320);
    expect(response.detectedOffsetOffsetMs!).toBeGreaterThan(350);
    expect(response.detectedOffsetOffsetMs!).toBeLessThan(520);
  });

  it('мягко деградирует на шумном окне без активации', async () => {
    client = createIpcWorkerClient(createComputeWorkerSpec());
    await client.start();

    const sampleRateHz = 1_000;
    const values = new Float32Array(800);
    for (let index = 0; index < values.length; index += 1) {
      values[index] = Math.sin((2 * Math.PI * 8 * index) / sampleRateHz) * 0.01;
    }

    const responsePayload = await client.request('pedaling.emg.detect', encodePedalingEmgRequest({
      cycleId: 2,
      windowStartSessionMs: 2_000,
      sampleRateHz,
      values,
      expectedActiveStartOffsetMs: 200,
      expectedActiveEndOffsetMs: 500,
    }));
    const response = decodePedalingEmgResponse(responsePayload);

    expect(['low_snr', 'no_activation']).toContain(response.status);
    expect(response.confidence).toBe(0);
  });
});
