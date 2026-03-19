import { createFrameDecoder, encodeFrame } from './framing.ts';
import {
  createReadyEnvelope,
  createResponseEnvelope,
  decodeTransportEnvelope,
  encodeTransportEnvelope,
} from './transport-codec.ts';

function writeEnvelope(buffer: Uint8Array): void {
  process.stdout.write(Buffer.from(encodeFrame(buffer)));
}

function emitReady(): void {
  writeEnvelope(encodeTransportEnvelope(createReadyEnvelope({
    protocolVersion: Number(process.env.SENSYNC2_TEST_PROTOCOL_VERSION ?? '1'),
    workerVersion: 'test-worker',
    methods: ['test.crash', 'test.echo', 'test.exit', 'test.slow'],
  })));
}

async function handleRequest(frame: Uint8Array): Promise<void> {
  const envelope = decodeTransportEnvelope(frame);
  const payload = envelope.payload;
  if (!payload) {
    return;
  }
  if (payload.$case === 'shutdown') {
    process.exit(0);
  }
  if (payload.$case !== 'request') {
    return;
  }

  const request = payload.request;
  if (request.method === 'test.exit') {
    process.exit(17);
  }
  if (request.method === 'test.slow') {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (request.method === 'test.crash') {
    writeEnvelope(encodeTransportEnvelope(createResponseEnvelope({
      requestId: request.requestId,
      ok: false,
      payload: new Uint8Array(),
      error: {
        code: 'worker_method_failed',
        message: 'boom',
      },
    })));
    return;
  }

  writeEnvelope(encodeTransportEnvelope(createResponseEnvelope({
    requestId: request.requestId,
    ok: true,
    payload: request.payload,
  })));
}

async function main(): Promise<void> {
  emitReady();
  const decoder = createFrameDecoder();

  process.stdin.on('data', (chunk: Buffer) => {
    void (async () => {
      const frames = decoder.push(chunk);
      for (const frame of frames) {
        await handleRequest(frame);
      }
    })();
  });
}

void main();
