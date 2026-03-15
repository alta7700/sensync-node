import { RuntimeHost } from './runtime-host.ts';
import { buildLaunchProfile, resolveLaunchProfile } from './profiles/index.ts';

async function main(): Promise<void> {
  const profile = resolveLaunchProfile(process.env.SENSYNC2_PROFILE);
  const launchProfile = buildLaunchProfile(profile, process.env);
  const runtime = new RuntimeHost({
    plugins: launchProfile.plugins,
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
  console.log(`Runtime started with profile "${launchProfile.id}". Press Ctrl+C to stop.`);

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
