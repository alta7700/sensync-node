import { RuntimeHost } from './runtime-host.ts';
import { makePluginDescriptors, resolveLaunchProfile } from './default-plugins.ts';

async function main(): Promise<void> {
  const profile = resolveLaunchProfile(process.env.SENSYNC2_PROFILE);
  const runtime = new RuntimeHost({
    plugins: makePluginDescriptors(profile),
    uiSinks: {
      onControl(payload) {
        console.log('[UI control]', payload.message.type);
      },
      onBinary(payload) {
        console.log('[UI binary]', payload.data.byteLength);
      },
    },
  });

  await runtime.start();
  console.log(`Runtime started with profile "${profile}". Press Ctrl+C to stop.`);

  process.on('SIGINT', async () => {
    await runtime.stop();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await runtime.stop();
    process.exit(0);
  });
}

void main();
