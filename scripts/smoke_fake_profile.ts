import assert from 'node:assert/strict';
import { RuntimeHost, buildLaunchProfile } from '../apps/runtime/src/index';

type ControlMessage = { type: string; [key: string]: unknown };

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function main(): Promise<void> {
  const controlMessages: ControlMessage[] = [];
  let binaryFrames = 0;

  const launchProfile = buildLaunchProfile('fake', process.env);
  const runtime = new RuntimeHost({
    plugins: launchProfile.plugins,
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
    await wait(350);
  } finally {
    await runtime.stop();
  }

  const initMessage = controlMessages.find((message) => message.type === 'ui.init');
  assert(initMessage, 'Ожидалось сообщение ui.init для fake профиля');
  assert.equal(initMessage.sessionId, 'local-desktop', 'sessionId fake профиля должен materialize\'иться из profile config');

  const schema = initMessage.schema as { pages?: Array<{ title?: string }>; widgets?: Array<{ id?: string }> } | undefined;
  assert(schema, 'ui.init должен содержать schema');
  assert.equal(schema.pages?.[0]?.title, 'Main', 'Ожидалась fake schema');

  const widgetIds = new Set((schema.widgets ?? []).map((widget) => widget.id).filter((value): value is string => typeof value === 'string'));
  assert(widgetIds.has('controls-main'), 'В fake schema должен быть controls-main');
  assert(widgetIds.has('chart-fake-a1'), 'В fake schema должен быть chart-fake-a1');

  const streamDeclares = controlMessages.filter((message) => message.type === 'ui.stream.declare');
  const declaredStreamIds = new Set(
    streamDeclares
      .map((message) => (message.stream as { streamId?: string } | undefined)?.streamId)
      .filter((value): value is string => typeof value === 'string'),
  );

  assert(declaredStreamIds.has('fake.a1'), 'Ожидался ui.stream.declare для fake.a1');
  assert(declaredStreamIds.has('fake.a2'), 'Ожидался ui.stream.declare для fake.a2');
  assert(declaredStreamIds.has('fake.b'), 'Ожидался ui.stream.declare для fake.b');
  assert(binaryFrames > 0, 'Ожидались binary frames от fake профиля');

  const flagPatches = controlMessages.filter((message) => message.type === 'ui.flags.patch');
  const mergedFlags = Object.assign({}, ...flagPatches.map((message) => message.patch as Record<string, unknown>));
  assert.equal(mergedFlags['adapter.fake.state'], 'connected', 'Ожидалось autoconnect состояние fake adapter');

  console.log('Fake profile smoke OK');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
