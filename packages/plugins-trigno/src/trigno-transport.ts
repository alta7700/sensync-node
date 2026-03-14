import net from 'node:net';
import {
  normalizeTrignoUnits,
  type TrignoChannelSnapshot,
  type TrignoStatusSnapshot,
} from './trigno-boundary.ts';

const CommandTerminator = '\r\n\r\n';
const CommandTerminatorBuffer = Buffer.from(CommandTerminator, 'ascii');
const TrignoChannelSlots = 16;
const EmgFrameWidth = 1;
const AuxFrameWidth = 9;

export const TrignoEmgStepBytes = TrignoChannelSlots * EmgFrameWidth * 4;
export const TrignoAuxStepBytes = TrignoChannelSlots * AuxFrameWidth * 4;

export interface TrignoTcpSessionOptions {
  host: string;
  sensorSlot: number;
  commandPort: number;
  emgPort: number;
  auxPort: number;
  dataSocketReadyDelayMs?: number;
  commandTimeoutMs: number;
  startTimeoutMs?: number;
  stopTimeoutMs: number;
}

export interface TrignoDataCallbacks {
  onEmgSamples?: (values: Float32Array) => void;
  onGyroSamples?: (samples: { x: Float32Array; y: Float32Array; z: Float32Array }) => void;
}

export class TrignoCommandRejectedError extends Error {
  readonly command: string;
  readonly response: string;

  constructor(command: string, response: string) {
    super(`Trigno отклонил команду ${command}: ${response}`);
    this.name = 'TrignoCommandRejectedError';
    this.command = command;
    this.response = response;
  }
}

export class TrignoSocketReader {
  private readonly socket: net.Socket;
  private buffer = Buffer.alloc(0);
  private pendingReads: Array<{
    resolve: (value: string) => void;
    reject: (error: Error) => void;
    timeoutId: NodeJS.Timeout;
  }> = [];
  private closedError: Error | null = null;

  constructor(socket: net.Socket) {
    this.socket = socket;
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('close', () => this.onClosed(new Error('TCP сокет Trigno закрыт')));
    socket.on('error', (error) => this.onClosed(error instanceof Error ? error : new Error(String(error))));
  }

  async read(timeoutMs: number): Promise<string> {
    const ready = this.tryConsumePacket();
    if (ready !== null) {
      return ready;
    }
    if (this.closedError) {
      throw this.closedError;
    }

    return new Promise<string>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingReads = this.pendingReads.filter((candidate) => candidate.timeoutId !== timeoutId);
        reject(new Error(`Trigno не ответил за ${timeoutMs}ms`));
      }, timeoutMs);
      this.pendingReads.push({ resolve, reject, timeoutId });
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk]);
    this.flush();
  }

  private onClosed(error: Error): void {
    if (this.closedError) return;
    this.closedError = error;
    while (this.pendingReads.length > 0) {
      const pending = this.pendingReads.shift();
      if (!pending) break;
      clearTimeout(pending.timeoutId);
      pending.reject(error);
    }
  }

  private flush(): void {
    while (this.pendingReads.length > 0) {
      const packet = this.tryConsumePacket();
      if (packet === null) break;
      const pending = this.pendingReads.shift();
      if (!pending) break;
      clearTimeout(pending.timeoutId);
      pending.resolve(packet);
    }
  }

  private tryConsumePacket(): string | null {
    const packetEnd = this.buffer.indexOf(CommandTerminatorBuffer);
    if (packetEnd < 0) return null;
    const packet = this.buffer.subarray(0, packetEnd);
    this.buffer = this.buffer.subarray(packetEnd + CommandTerminatorBuffer.length);
    return packet.toString('ascii').trim();
  }
}

export class TrignoPacketAccumulator {
  private readonly stepBytes: number;
  private buffer = Buffer.alloc(0);

  constructor(stepBytes: number) {
    this.stepBytes = stepBytes;
  }

  append(chunk: Buffer): Buffer | null {
    this.buffer = this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk]);
    const completeLength = this.buffer.length - (this.buffer.length % this.stepBytes);
    if (completeLength <= 0) {
      return null;
    }
    const packet = this.buffer.subarray(0, completeLength);
    this.buffer = this.buffer.subarray(completeLength);
    return packet;
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}

export function sliceEmgSamplesFromPacket(packet: Buffer, startIndex: number): Float32Array {
  const steps = Math.floor(packet.length / TrignoEmgStepBytes);
  const offset = Math.max(0, (startIndex - 1) * 4);
  const values = new Float32Array(steps);
  for (let stepIndex = 0; stepIndex < steps; stepIndex += 1) {
    values[stepIndex] = packet.readFloatLE((stepIndex * TrignoEmgStepBytes) + offset);
  }
  return values;
}

export function sliceGyroSamplesFromPacket(
  packet: Buffer,
  startIndex: number,
): { x: Float32Array; y: Float32Array; z: Float32Array } {
  const steps = Math.floor(packet.length / TrignoAuxStepBytes);
  const baseOffset = Math.max(0, (startIndex - 1) * AuxFrameWidth * 4);
  const x = new Float32Array(steps);
  const y = new Float32Array(steps);
  const z = new Float32Array(steps);
  for (let stepIndex = 0; stepIndex < steps; stepIndex += 1) {
    const packetOffset = (stepIndex * TrignoAuxStepBytes) + baseOffset;
    x[stepIndex] = packet.readFloatLE(packetOffset);
    y[stepIndex] = packet.readFloatLE(packetOffset + 4);
    z[stepIndex] = packet.readFloatLE(packetOffset + 8);
  }
  return { x, y, z };
}

async function connectSocket(host: string, port: number): Promise<net.Socket> {
  return new Promise<net.Socket>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const cleanup = () => {
      socket.removeListener('connect', handleConnect);
      socket.removeListener('error', handleError);
    };
    const handleConnect = () => {
      cleanup();
      socket.setNoDelay(true);
      resolve(socket);
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };
    socket.once('connect', handleConnect);
    socket.once('error', handleError);
  });
}

async function destroySocket(socket: net.Socket | null): Promise<void> {
  if (!socket) return;
  if (socket.destroyed) return;
  await new Promise<void>((resolve) => {
    const finish = () => resolve();
    socket.once('close', finish);
    socket.destroy();
    setTimeout(finish, 50).unref?.();
  });
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function parseBooleanResponse(command: string, response: string): boolean {
  if (response === 'YES') return true;
  if (response === 'NO') return false;
  throw new Error(`Trigno вернул неожиданный ответ для ${command}: ${response}`);
}

function parseUpsamplingResponse(command: string, response: string): boolean {
  if (response === 'UPSAMPLING ON') return true;
  if (response === 'UPSAMPLING OFF') return false;
  throw new Error(`Trigno вернул неожиданный ответ для ${command}: ${response}`);
}

function parseNumberResponse(command: string, response: string): number {
  const parsed = Number(response);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Trigno вернул нечисловой ответ для ${command}: ${response}`);
  }
  return parsed;
}

function normalizeRejectedResponse(command: string, response: string): string {
  const normalized = response.trim();
  if (normalized.length === 0) {
    throw new Error(`Trigno вернул пустой ответ для ${command}`);
  }
  if (normalized === 'INVALID COMMAND' || normalized === 'CANNOT COMPLETE') {
    throw new TrignoCommandRejectedError(command, normalized);
  }
  return normalized;
}

async function optionalQuery(client: TrignoCommandClient, command: string): Promise<string | null> {
  try {
    return await client.request(command);
  } catch (error) {
    if (error instanceof TrignoCommandRejectedError) {
      return null;
    }
    throw error;
  }
}

function parseProtocolVersion(banner: string): string | null {
  const match = /Version\s+([0-9.]+)/i.exec(banner);
  return match?.[1] ?? null;
}

function assertGyroLayout(channels: TrignoChannelSnapshot[]): TrignoChannelSnapshot {
  const [first, ...rest] = channels;
  if (!first) {
    throw new Error('Trigno не вернул каналы гироскопа');
  }
  for (const channel of rest) {
    if (
      channel.rateHz !== first.rateHz
      || channel.samplesPerFrame !== first.samplesPerFrame
      || channel.units !== first.units
      || channel.gain !== first.gain
    ) {
      throw new Error('Каналы гироскопа Trigno имеют разный layout');
    }
  }
  return first;
}

class TrignoCommandClient {
  private readonly socket: net.Socket;
  private readonly reader: TrignoSocketReader;

  constructor(socket: net.Socket) {
    this.socket = socket;
    this.reader = new TrignoSocketReader(socket);
  }

  async readBanner(timeoutMs: number): Promise<string> {
    return this.reader.read(timeoutMs);
  }

  async request(command: string, timeoutMs = 2_500): Promise<string> {
    const payload = Buffer.from(`${command}${CommandTerminator}`, 'ascii');
    this.socket.write(payload);
    const response = await this.reader.read(timeoutMs);
    return normalizeRejectedResponse(command, response);
  }
}

export class TrignoTcpSession {
  private readonly options: TrignoTcpSessionOptions;
  private commandSocket: net.Socket | null = null;
  private commandClient: TrignoCommandClient | null = null;
  private emgSocket: net.Socket | null = null;
  private auxSocket: net.Socket | null = null;
  private emgAccumulator = new TrignoPacketAccumulator(TrignoEmgStepBytes);
  private auxAccumulator = new TrignoPacketAccumulator(TrignoAuxStepBytes);
  private callbacks: TrignoDataCallbacks = {};
  private disconnectReason: string | null = null;
  private closing = false;
  private snapshot: TrignoStatusSnapshot | null = null;
  private banner = '';
  private streaming = false;

  constructor(options: TrignoTcpSessionOptions) {
    this.options = options;
  }

  async connect(): Promise<string> {
    this.commandSocket = await connectSocket(this.options.host, this.options.commandPort);
    this.commandClient = new TrignoCommandClient(this.commandSocket);
    this.installSocketLifecycle(this.commandSocket, 'command');
    this.banner = await this.commandClient.readBanner(this.options.commandTimeoutMs);
    return this.banner;
  }

  async applyProfileConfig(): Promise<void> {
    const client = this.requireCommandClient();
    await client.request('TRIGGER START OFF', this.options.commandTimeoutMs);
    await client.request('TRIGGER STOP OFF', this.options.commandTimeoutMs);
    await client.request('ENDIAN LITTLE', this.options.commandTimeoutMs);
    await client.request('BACKWARDS COMPATIBILITY ON', this.options.commandTimeoutMs);
    await client.request('UPSAMPLE ON', this.options.commandTimeoutMs);
    await client.request(`SENSOR ${this.options.sensorSlot} SETMODE 7`, this.options.commandTimeoutMs);
  }

  async queryStatus(): Promise<TrignoStatusSnapshot> {
    const client = this.requireCommandClient();
    const slot = this.options.sensorSlot;

    const paired = parseBooleanResponse(`SENSOR ${slot} PAIRED?`, await client.request(`SENSOR ${slot} PAIRED?`, this.options.commandTimeoutMs));
    const mode = parseNumberResponse(`SENSOR ${slot} MODE?`, await client.request(`SENSOR ${slot} MODE?`, this.options.commandTimeoutMs));
    const startIndex = parseNumberResponse(
      `SENSOR ${slot} STARTINDEX?`,
      await client.request(`SENSOR ${slot} STARTINDEX?`, this.options.commandTimeoutMs),
    );
    const channelCount = parseNumberResponse(
      `SENSOR ${slot} CHANNELCOUNT?`,
      await client.request(`SENSOR ${slot} CHANNELCOUNT?`, this.options.commandTimeoutMs),
    );
    const emgChannelCount = parseNumberResponse(
      `SENSOR ${slot} EMGCHANNELCOUNT?`,
      await client.request(`SENSOR ${slot} EMGCHANNELCOUNT?`, this.options.commandTimeoutMs),
    );
    const auxChannelCount = parseNumberResponse(
      `SENSOR ${slot} AUXCHANNELCOUNT?`,
      await client.request(`SENSOR ${slot} AUXCHANNELCOUNT?`, this.options.commandTimeoutMs),
    );
    const backwardsCompatibility = parseBooleanResponse(
      'BACKWARDS COMPATIBILITY?',
      await client.request('BACKWARDS COMPATIBILITY?', this.options.commandTimeoutMs),
    );
    const upsampling = parseUpsamplingResponse(
      'UPSAMPLING?',
      await client.request('UPSAMPLING?', this.options.commandTimeoutMs),
    );
    const frameInterval = parseNumberResponse('FRAME INTERVAL?', await client.request('FRAME INTERVAL?', this.options.commandTimeoutMs));
    const maxSamplesEmg = parseNumberResponse('MAX SAMPLES EMG?', await client.request('MAX SAMPLES EMG?', this.options.commandTimeoutMs));
    const maxSamplesAux = parseNumberResponse('MAX SAMPLES AUX?', await client.request('MAX SAMPLES AUX?', this.options.commandTimeoutMs));
    const serial = await optionalQuery(client, `SENSOR ${slot} SERIAL?`);
    const firmware = await optionalQuery(client, `SENSOR ${slot} FIRMWARE?`);
    const emg = await this.queryChannel(slot, 1);
    const gyro = assertGyroLayout([
      await this.queryChannel(slot, 2),
      await this.queryChannel(slot, 3),
      await this.queryChannel(slot, 4),
    ]);

    this.snapshot = {
      host: this.options.host,
      sensorSlot: slot,
      banner: this.banner,
      protocolVersion: parseProtocolVersion(this.banner),
      paired,
      mode,
      startIndex,
      channelCount,
      emgChannelCount,
      auxChannelCount,
      backwardsCompatibility,
      upsampling,
      frameInterval,
      maxSamplesEmg,
      maxSamplesAux,
      serial,
      firmware,
      emg,
      gyro,
    };

    return this.snapshot;
  }

  setDataCallbacks(callbacks: TrignoDataCallbacks): void {
    this.callbacks = callbacks;
  }

  async openDataSockets(): Promise<void> {
    if (!this.snapshot) {
      throw new Error('Нельзя открыть data sockets Trigno без status snapshot');
    }
    if (!this.emgSocket) {
      this.emgSocket = await connectSocket(this.options.host, this.options.emgPort);
      this.installSocketLifecycle(this.emgSocket, 'emg');
      this.emgSocket.on('data', (chunk) => this.handleEmgData(chunk));
    }
    if (!this.auxSocket) {
      this.auxSocket = await connectSocket(this.options.host, this.options.auxPort);
      this.installSocketLifecycle(this.auxSocket, 'aux');
      this.auxSocket.on('data', (chunk) => this.handleAuxData(chunk));
    }
    await sleep(this.options.dataSocketReadyDelayMs ?? 350);
  }

  async start(): Promise<void> {
    const client = this.requireCommandClient();
    await client.request('START', this.options.startTimeoutMs ?? this.options.commandTimeoutMs);
    this.streaming = true;
  }

  async stop(): Promise<void> {
    if (!this.streaming) return;
    const client = this.requireCommandClient();
    await client.request('STOP', this.options.stopTimeoutMs);
    this.streaming = false;
  }

  async close(): Promise<void> {
    this.closing = true;
    this.streaming = false;
    this.snapshot = null;
    this.emgAccumulator.reset();
    this.auxAccumulator.reset();
    await Promise.all([
      destroySocket(this.auxSocket),
      destroySocket(this.emgSocket),
      destroySocket(this.commandSocket),
    ]);
    this.auxSocket = null;
    this.emgSocket = null;
    this.commandSocket = null;
    this.commandClient = null;
    this.closing = false;
    this.disconnectReason = null;
  }

  takeDisconnectReason(): string | null {
    const reason = this.disconnectReason;
    this.disconnectReason = null;
    return reason;
  }

  getSnapshot(): TrignoStatusSnapshot | null {
    return this.snapshot;
  }

  private async queryChannel(slot: number, channelNumber: number): Promise<TrignoChannelSnapshot> {
    const client = this.requireCommandClient();
    const commandPrefix = `SENSOR ${slot} CHANNEL ${channelNumber}`;
    const rateHz = parseNumberResponse(`${commandPrefix} RATE?`, await client.request(`${commandPrefix} RATE?`, this.options.commandTimeoutMs));
    const samplesPerFrame = parseNumberResponse(
      `${commandPrefix} SAMPLES?`,
      await client.request(`${commandPrefix} SAMPLES?`, this.options.commandTimeoutMs),
    );
    const unitsRaw = await client.request(`${commandPrefix} UNITS?`, this.options.commandTimeoutMs);
    const gain = parseNumberResponse(`${commandPrefix} GAIN?`, await client.request(`${commandPrefix} GAIN?`, this.options.commandTimeoutMs));
    return {
      rateHz,
      samplesPerFrame,
      units: normalizeTrignoUnits(unitsRaw),
      gain,
    };
  }

  private requireCommandClient(): TrignoCommandClient {
    if (!this.commandClient) {
      throw new Error('Command socket Trigno не инициализирован');
    }
    return this.commandClient;
  }

  private installSocketLifecycle(socket: net.Socket, label: string): void {
    socket.on('error', (error) => this.registerDisconnect(`${label} socket error: ${error.message}`));
    socket.on('close', () => this.registerDisconnect(`${label} socket closed`));
  }

  private registerDisconnect(reason: string): void {
    if (this.closing) return;
    if (this.disconnectReason !== null) return;
    this.disconnectReason = reason;
  }

  private handleEmgData(chunk: Buffer): void {
    if (!this.snapshot) return;
    const packet = this.emgAccumulator.append(chunk);
    if (!packet) return;
    const values = sliceEmgSamplesFromPacket(packet, this.snapshot.startIndex);
    if (values.length > 0) {
      this.callbacks.onEmgSamples?.(values);
    }
  }

  private handleAuxData(chunk: Buffer): void {
    if (!this.snapshot) return;
    const packet = this.auxAccumulator.append(chunk);
    if (!packet) return;
    const samples = sliceGyroSamplesFromPacket(packet, this.snapshot.startIndex);
    if (samples.x.length > 0) {
      this.callbacks.onGyroSamples?.(samples);
    }
  }
}
