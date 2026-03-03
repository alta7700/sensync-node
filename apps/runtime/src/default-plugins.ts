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
      id: 'fake-signal-adapter',
      modulePath: moduleFileUrl('packages/plugins-fake/src/fake-signal-adapter.ts'),
      // `a1` нужен для сравнения "старых" параметров batching с текущими `a2`.
      config: { sampleRateHz: 10_000, batchMs: 100, compareSampleRateHz: 10_000, compareBatchMs: 50 },
    },
    {
      id: 'shape-generator-adapter',
      modulePath: moduleFileUrl('packages/plugins-fake/src/shape-generator-adapter.ts'),
      config: { sampleRateHz: 200, batchMs: 50 },
    },
    {
      id: 'interval-label-adapter',
      modulePath: moduleFileUrl('packages/plugins-fake/src/interval-label-adapter.ts'),
    },
    {
      id: 'rolling-min-processor',
      modulePath: moduleFileUrl('packages/plugins-fake/src/rolling-min-processor.ts'),
      config: { sourceChannelId: 'fake.a2', outputChannelId: 'metrics.fake.a2.rolling_min_1s' },
    },
    {
      id: 'activity-detector-processor',
      modulePath: moduleFileUrl('packages/plugins-fake/src/activity-detector-processor.ts'),
      config: { sourceChannelId: 'shapes.signal', threshold: 0.6 },
    },
    {
      id: 'ui-gateway',
      modulePath: moduleFileUrl('packages/plugins-ui-gateway/src/ui-gateway-plugin.ts'),
      config: { sessionId: 'local-desktop' },
    },
  ];
}
