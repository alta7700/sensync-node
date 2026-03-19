import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createIpcWorkerClient } from './client.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const echoWorkerScript = path.join(repoRoot, 'packages/plugin-kit/src/ipc-worker/echo-worker.ts');

function createTestClient() {
  return createIpcWorkerClient({
    command: process.execPath,
    args: ['--import=tsx', echoWorkerScript],
    cwd: repoRoot,
    env: {},
    workerName: 'echo-worker',
    readyTimeoutMs: 10_000,
  });
}

function createVersionMismatchClient() {
  return createIpcWorkerClient({
    command: process.execPath,
    args: ['--import=tsx', echoWorkerScript],
    cwd: repoRoot,
    env: {
      SENSYNC2_TEST_PROTOCOL_VERSION: '999',
    },
    workerName: 'echo-worker-bad-version',
    readyTimeoutMs: 10_000,
  });
}

describe('createIpcWorkerClient', () => {
  it('поднимает worker, читает ready и делает request/response', async () => {
    const client = createTestClient();
    await client.start();

    expect(client.readyMethods()).toContain('test.echo');
    const response = await client.request('test.echo', Uint8Array.from([1, 2, 3]));
    expect(Array.from(response)).toEqual([1, 2, 3]);

    await client.close();
  });

  it('перезапускает процесс после crash на следующем запросе', async () => {
    const client = createTestClient();
    await client.start();

    await expect(client.request('test.exit', new Uint8Array())).rejects.toThrow(/завершился/);
    const response = await client.request('test.echo', Uint8Array.from([9]));
    expect(Array.from(response)).toEqual([9]);

    await client.close();
  });

  it('отклоняет worker с несовместимой версией протокола', async () => {
    const client = createVersionMismatchClient();
    await expect(client.start()).rejects.toThrow(/несовместимая версия протокола/);
  });
});
