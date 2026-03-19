import * as path from 'node:path';
import type { IpcWorkerProcessSpec } from '@sensync2/plugin-kit/ipc-worker';
import { runtimeRepoRoot } from './launch-profile-boundary.ts';

const pythonRuntimeProject = path.join(runtimeRepoRoot, 'packages/plugin-kit/python-runtime');

export function resolveDevPythonComputeWorkerSpec(
  relativeScriptPathFromRepoRoot: string,
  overrides?: Partial<IpcWorkerProcessSpec>,
): IpcWorkerProcessSpec {
  const absoluteScriptPath = path.join(runtimeRepoRoot, relativeScriptPathFromRepoRoot);
  return {
    command: 'uv',
    args: ['run', '--project', pythonRuntimeProject, 'python', absoluteScriptPath],
    cwd: runtimeRepoRoot,
    env: {
      ...overrides?.env,
      PYTHONUNBUFFERED: '1',
    },
    workerName: path.basename(relativeScriptPathFromRepoRoot),
    readyTimeoutMs: 10_000,
    requestTimeoutMs: 10_000,
    shutdownTimeoutMs: 2_000,
    ...overrides,
  };
}
