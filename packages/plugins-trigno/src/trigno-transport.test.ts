import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  TrignoTcpSession,
  sliceEmgSamplesFromPacket,
  sliceGyroSamplesFromPacket,
} from './trigno-transport.ts';

const CommandTerminator = '\r\n\r\n';

interface MockTrignoServer {
  host: string;
  commandPort: number;
  emgPort: number;
  auxPort: number;
  close(): Promise<void>;
  sendData(): void;
}

function buildEmgPacket(startIndex: number, samples: readonly number[]): Buffer {
  const packet = Buffer.alloc(samples.length * 16 * 4);
  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    packet.writeFloatLE(samples[sampleIndex] ?? 0, (sampleIndex * 16 * 4) + ((startIndex - 1) * 4));
  }
  return packet;
}

function buildAuxPacket(
  startIndex: number,
  samples: ReadonlyArray<{ x: number; y: number; z: number }>,
): Buffer {
  const packet = Buffer.alloc(samples.length * 16 * 9 * 4);
  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    const base = (sampleIndex * 16 * 9 * 4) + ((startIndex - 1) * 9 * 4);
    packet.writeFloatLE(samples[sampleIndex]?.x ?? 0, base);
    packet.writeFloatLE(samples[sampleIndex]?.y ?? 0, base + 4);
    packet.writeFloatLE(samples[sampleIndex]?.z ?? 0, base + 8);
  }
  return packet;
}

async function listenServer(handler: (socket: net.Socket) => void): Promise<{ server: net.Server; port: number }> {
  const server = net.createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Не удалось поднять тестовый TCP server');
  }
  return { server, port: address.port };
}

async function createMockTrignoServer(): Promise<MockTrignoServer> {
  const dataSockets = {
    emg: null as net.Socket | null,
    aux: null as net.Socket | null,
  };
  const delayedWrites: NodeJS.Timeout[] = [];

  const writeChunks = (socket: net.Socket, buffer: Buffer) => {
    const midpoint = Math.max(1, Math.min(buffer.length - 1, 37));
    socket.write(buffer.subarray(0, midpoint));
    const timeoutId = setTimeout(() => {
      socket.write(buffer.subarray(midpoint));
    }, 10);
    delayedWrites.push(timeoutId);
  };

  const commandResponses = new Map<string, string>([
    ['TRIGGER START OFF', 'OK'],
    ['TRIGGER STOP OFF', 'OK'],
    ['ENDIAN LITTLE', 'OK'],
    ['BACKWARDS COMPATIBILITY ON', 'OK'],
    ['UPSAMPLE ON', 'OK'],
    ['SENSOR 1 SETMODE 7', 'SENSOR 1 SET TO MODE 7'],
    ['SENSOR 1 PAIRED?', 'YES'],
    ['SENSOR 1 MODE?', '7'],
    ['SENSOR 1 STARTINDEX?', '2'],
    ['SENSOR 1 CHANNELCOUNT?', '4'],
    ['SENSOR 1 EMGCHANNELCOUNT?', '1'],
    ['SENSOR 1 AUXCHANNELCOUNT?', '3'],
    ['BACKWARDS COMPATIBILITY?', 'YES'],
    ['UPSAMPLING?', 'UPSAMPLING ON'],
    ['FRAME INTERVAL?', '0.0135'],
    ['MAX SAMPLES EMG?', '26'],
    ['MAX SAMPLES AUX?', '2'],
    ['SENSOR 1 SERIAL?', 'SP-W02C-1759'],
    ['SENSOR 1 FIRMWARE?', '3.6.0'],
    ['SENSOR 1 CHANNEL 1 RATE?', '1925.92592592593'],
    ['SENSOR 1 CHANNEL 1 SAMPLES?', '26'],
    ['SENSOR 1 CHANNEL 1 UNITS?', 'V'],
    ['SENSOR 1 CHANNEL 1 GAIN?', '300'],
    ['SENSOR 1 CHANNEL 2 RATE?', '148.148148148148'],
    ['SENSOR 1 CHANNEL 2 SAMPLES?', '2'],
    ['SENSOR 1 CHANNEL 2 UNITS?', '?/s'],
    ['SENSOR 1 CHANNEL 2 GAIN?', '16.4'],
    ['SENSOR 1 CHANNEL 3 RATE?', '148.148148148148'],
    ['SENSOR 1 CHANNEL 3 SAMPLES?', '2'],
    ['SENSOR 1 CHANNEL 3 UNITS?', '?/s'],
    ['SENSOR 1 CHANNEL 3 GAIN?', '16.4'],
    ['SENSOR 1 CHANNEL 4 RATE?', '148.148148148148'],
    ['SENSOR 1 CHANNEL 4 SAMPLES?', '2'],
    ['SENSOR 1 CHANNEL 4 UNITS?', '?/s'],
    ['SENSOR 1 CHANNEL 4 GAIN?', '16.4'],
  ]);

  const { server: commandServer, port: commandPort } = await listenServer((socket) => {
    socket.write(`Delsys Trigno System Digital Protocol Version 3.6.0${CommandTerminator}`);
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('ascii');
      let endIndex = buffer.indexOf(CommandTerminator);
      while (endIndex >= 0) {
        const command = buffer.slice(0, endIndex).trim();
        buffer = buffer.slice(endIndex + CommandTerminator.length);

        if (command === 'START') {
          if (!dataSockets.emg || !dataSockets.aux) {
            endIndex = buffer.indexOf(CommandTerminator);
            continue;
          }
          socket.write(`OK${CommandTerminator}`);
          endIndex = buffer.indexOf(CommandTerminator);
          continue;
        }

        if (command === 'STOP') {
          const timeoutId = setTimeout(() => {
            socket.write(`OK${CommandTerminator}`);
          }, 50);
          delayedWrites.push(timeoutId);
          endIndex = buffer.indexOf(CommandTerminator);
          continue;
        }

        socket.write(`${commandResponses.get(command) ?? 'INVALID COMMAND'}${CommandTerminator}`);
        endIndex = buffer.indexOf(CommandTerminator);
      }
    });
  });

  const { server: emgServer, port: emgPort } = await listenServer((socket) => {
    dataSockets.emg = socket;
  });
  const { server: auxServer, port: auxPort } = await listenServer((socket) => {
    dataSockets.aux = socket;
  });

  return {
    host: '127.0.0.1',
    commandPort,
    emgPort,
    auxPort,
    sendData() {
      if (!dataSockets.emg || !dataSockets.aux) {
        throw new Error('data sockets ещё не подключены');
      }
      writeChunks(dataSockets.emg, buildEmgPacket(2, [0.25, 0.5]));
      writeChunks(dataSockets.aux, buildAuxPacket(2, [
        { x: 1, y: 2, z: 3 },
        { x: 4, y: 5, z: 6 },
      ]));
    },
    async close() {
      delayedWrites.forEach((timeoutId) => clearTimeout(timeoutId));
      dataSockets.emg?.destroy();
      dataSockets.aux?.destroy();
      await Promise.all([
        new Promise<void>((resolve) => commandServer.close(() => resolve())),
        new Promise<void>((resolve) => emgServer.close(() => resolve())),
        new Promise<void>((resolve) => auxServer.close(() => resolve())),
      ]);
    },
  };
}

const serversToClose: MockTrignoServer[] = [];

afterEach(async () => {
  while (serversToClose.length > 0) {
    const server = serversToClose.pop();
    await server?.close();
  }
});

describe('trigno-transport', () => {
  it('режет EMG/AUX packet по STARTINDEX', () => {
    const emg = sliceEmgSamplesFromPacket(buildEmgPacket(3, [11, 22]), 3);
    const gyro = sliceGyroSamplesFromPacket(buildAuxPacket(3, [
      { x: 7, y: 8, z: 9 },
      { x: 10, y: 11, z: 12 },
    ]), 3);

    expect([...emg]).toEqual([11, 22]);
    expect([...gyro.x]).toEqual([7, 10]);
    expect([...gyro.y]).toEqual([8, 11]);
    expect([...gyro.z]).toEqual([9, 12]);
  });

  it('читает banner, не даёт START без data sockets и обрабатывает delayed STOP', async () => {
    const server = await createMockTrignoServer();
    serversToClose.push(server);

    const session = new TrignoTcpSession({
      host: server.host,
      sensorSlot: 1,
      commandPort: server.commandPort,
      emgPort: server.emgPort,
      auxPort: server.auxPort,
      commandTimeoutMs: 100,
      stopTimeoutMs: 250,
    });

    const banner = await session.connect();
    expect(banner).toContain('3.6.0');

    await session.applyProfileConfig();
    const snapshot = await session.queryStatus();
    expect(snapshot.startIndex).toBe(2);
    expect(snapshot.gyro.units).toBe('deg/s');

    await expect(session.start()).rejects.toThrow(/100ms/);

    await session.openDataSockets();
    await session.start();
    await session.stop();
    await session.close();
  });

  it('аккумулирует неполные TCP reads и извлекает EMG + gyro samples', async () => {
    const server = await createMockTrignoServer();
    serversToClose.push(server);

    const session = new TrignoTcpSession({
      host: server.host,
      sensorSlot: 1,
      commandPort: server.commandPort,
      emgPort: server.emgPort,
      auxPort: server.auxPort,
      commandTimeoutMs: 200,
      stopTimeoutMs: 250,
    });

    const emgBatches: number[][] = [];
    const gyroBatches: Array<{ x: number[]; y: number[]; z: number[] }> = [];

    await session.connect();
    await session.applyProfileConfig();
    await session.queryStatus();
    session.setDataCallbacks({
      onEmgSamples(values) {
        emgBatches.push([...values]);
      },
      onGyroSamples(values) {
        gyroBatches.push({
          x: [...values.x],
          y: [...values.y],
          z: [...values.z],
        });
      },
    });
    await session.openDataSockets();
    await session.start();

    server.sendData();
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(emgBatches).toEqual([[0.25, 0.5]]);
    expect(gyroBatches).toEqual([
      {
        x: [1, 4],
        y: [2, 5],
        z: [3, 6],
      },
    ]);

    await session.stop();
    await session.close();
  });
});
