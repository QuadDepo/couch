// Protobuf varint encoding: each byte uses 7 bits for data + 1 continuation bit (MSB).
// If MSB is set, more bytes follow. Final byte has MSB unset.
export function encodeVarint(input: number): Uint8Array {
  const bytes: number[] = [];
  let value = input;
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value & 0x7f);
  return new Uint8Array(bytes);
}

export function decodeVarint(data: Uint8Array, offset = 0): { value: number; bytesRead: number } {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;

  while (offset + bytesRead < data.length) {
    const byte = data[offset + bytesRead] as number;
    // Extract 7 data bits and place them at the correct position
    value |= (byte & 0x7f) << shift;
    bytesRead++;

    // MSB unset means this is the final byte
    if ((byte & 0x80) === 0) {
      return { value, bytesRead };
    }

    shift += 7;
    if (shift > 35) {
      throw new Error("Varint too long");
    }
  }

  throw new Error("Incomplete varint");
}

// Wire format: varint-encoded length prefix followed by the message bytes
export function frameMessage(data: Uint8Array): Uint8Array {
  const length = encodeVarint(data.length);
  const framed = new Uint8Array(length.length + data.length);
  framed.set(length, 0);
  framed.set(data, length.length);
  return framed;
}

export interface FrameReaderResult {
  message: Uint8Array | null;
  remainingBuffer: Uint8Array;
}

export function readFramedMessage(buffer: Uint8Array): FrameReaderResult {
  if (buffer.length === 0) {
    return { message: null, remainingBuffer: buffer };
  }

  try {
    const { value: messageLength, bytesRead: headerLength } = decodeVarint(buffer);
    const totalLength = headerLength + messageLength;

    if (buffer.length < totalLength) {
      return { message: null, remainingBuffer: buffer };
    }

    const message = buffer.slice(headerLength, totalLength);
    const remainingBuffer = buffer.slice(totalLength);

    return { message, remainingBuffer };
  } catch {
    return { message: null, remainingBuffer: buffer };
  }
}

export function createFrameReader() {
  let buffer: Uint8Array = new Uint8Array(0);

  return {
    append(data: Uint8Array) {
      const newBuffer = new Uint8Array(buffer.length + data.length);
      newBuffer.set(buffer, 0);
      newBuffer.set(data, buffer.length);
      buffer = newBuffer;
    },

    read(): Uint8Array | null {
      const result = readFramedMessage(buffer);
      buffer = new Uint8Array(result.remainingBuffer);
      return result.message;
    },

    clear() {
      buffer = new Uint8Array(0);
    },
  };
}
