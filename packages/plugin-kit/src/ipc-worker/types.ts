export interface IpcWorkerProcessSpec {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  expectedProtocolVersion?: number;
  readyTimeoutMs?: number;
  requestTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  workerName?: string;
}

export interface IpcWorkerRequestOptions {
  timeoutMs?: number;
}

export interface IpcWorkerClient {
  start(): Promise<void>;
  request(method: string, payload: Uint8Array, options?: IpcWorkerRequestOptions): Promise<Uint8Array>;
  close(): Promise<void>;
  isBusy(): boolean;
  readyMethods(): readonly string[];
}

export type IpcTypedArray = Float32Array | Float64Array | Int16Array;
export type IpcSampleFormat = 'f32' | 'f64' | 'i16';
