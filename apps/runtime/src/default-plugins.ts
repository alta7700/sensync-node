import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { PluginDescriptor } from './types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function moduleFileUrl(relativePathFromRepoRoot: string): string {
  return pathToFileURL(path.join(repoRoot, relativePathFromRepoRoot)).href;
}

/**
 * Дефолтный набор плагинов `v1`.
 *
 * Все плагины запускаются в worker'ах и импортируются напрямую из исходников.
 */
export function makeDefaultPluginDescriptors(): PluginDescriptor[] {
  return [
    {
      id: 'veloerg-h5-replay-adapter',
      modulePath: moduleFileUrl('packages/plugins-fake/src/veloerg-h5-replay-adapter.ts'),
      config: {
        adapterId: 'velo-replay',
        bundlePath: path.join(repoRoot, 'test.replay/manifest.json'),
        tickMs: 20,
        speed: 1,
        maxSamplesPerBatch: 3000,
      },
    },
    {
      id: 'ui-gateway',
      modulePath: moduleFileUrl('packages/plugins-ui-gateway/src/ui-gateway-plugin.ts'),
      config: { sessionId: 'local-desktop' },
    },
  ];
}
