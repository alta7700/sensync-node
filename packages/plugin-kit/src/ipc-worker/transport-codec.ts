import {
  Envelope,
  Request,
  Response,
  Shutdown,
  type Ready,
} from './generated/sensync2_plugin_kit/ipc_worker/transport.ts';

export function encodeTransportEnvelope(envelope: Envelope): Uint8Array {
  return Envelope.encode(envelope).finish();
}

export function decodeTransportEnvelope(payload: Uint8Array): Envelope {
  return Envelope.decode(payload);
}

export function createReadyEnvelope(ready: Ready): Envelope {
  return Envelope.create({
    payload: {
      $case: 'ready',
      ready,
    },
  });
}

export function createRequestEnvelope(request: Request): Envelope {
  return Envelope.create({
    payload: {
      $case: 'request',
      request,
    },
  });
}

export function createResponseEnvelope(response: Response): Envelope {
  return Envelope.create({
    payload: {
      $case: 'response',
      response,
    },
  });
}

export function createShutdownEnvelope(): Envelope {
  return Envelope.create({
    payload: {
      $case: 'shutdown',
      shutdown: Shutdown.create(),
    },
  });
}
