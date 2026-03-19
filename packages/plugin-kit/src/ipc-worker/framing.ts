export function encodeFrame(payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(4 + payload.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint32(0, payload.byteLength, true);
  frame.set(payload, 4);
  return frame;
}

export interface FrameDecoder {
  push(chunk: Uint8Array): Uint8Array[];
  reset(): void;
}

export function createFrameDecoder(): FrameDecoder {
  let buffer = new Uint8Array(0);

  return {
    push(chunk) {
      if (chunk.byteLength === 0) {
        return [];
      }

      const merged = new Uint8Array(buffer.byteLength + chunk.byteLength);
      merged.set(buffer, 0);
      merged.set(chunk, buffer.byteLength);
      buffer = merged;

      const frames: Uint8Array[] = [];
      let offset = 0;
      while ((buffer.byteLength - offset) >= 4) {
        const view = new DataView(buffer.buffer, buffer.byteOffset + offset, 4);
        const frameLength = view.getUint32(0, true);
        const frameEnd = offset + 4 + frameLength;
        if (buffer.byteLength < frameEnd) {
          break;
        }
        frames.push(buffer.slice(offset + 4, frameEnd));
        offset = frameEnd;
      }

      buffer = offset === 0 ? buffer : buffer.slice(offset);
      return frames;
    },
    reset() {
      buffer = new Uint8Array(0);
    },
  };
}
