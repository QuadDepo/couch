// Thrown when a varint's bytes are all present but the value is malformed
// (continuation bit never clears within the legal width). More input can never
// make it valid, so callers must surface/discard rather than wait.
class InvalidVarintError extends Error {}

// Thrown when a varint is cut off mid-encoding: the bytes seen so far are valid
// but the terminating byte has not arrived. Callers should wait for more data.
class IncompleteVarintError extends Error {}

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
      throw new InvalidVarintError("Varint too long");
    }
  }

  throw new IncompleteVarintError("Incomplete varint");
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

// Returns null (keep buffering) for merely-incomplete input; throws
// InvalidVarintError for definitively-invalid framing that no future bytes can
// fix. The two must not be conflated or invalid data wedges the buffer forever.
function readFramedMessage(buffer: Uint8Array): FrameReaderResult {
  if (buffer.length === 0) {
    return { message: null, remainingBuffer: buffer };
  }

  let messageLength: number;
  let headerLength: number;
  try {
    const header = decodeVarint(buffer);
    messageLength = header.value;
    headerLength = header.bytesRead;
  } catch (error) {
    if (error instanceof IncompleteVarintError) {
      return { message: null, remainingBuffer: buffer };
    }
    throw error;
  }

  const totalLength = headerLength + messageLength;
  if (buffer.length < totalLength) {
    return { message: null, remainingBuffer: buffer };
  }

  const message = buffer.slice(headerLength, totalLength);
  const remainingBuffer = buffer.slice(totalLength);

  return { message, remainingBuffer };
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
      let result: FrameReaderResult;
      try {
        result = readFramedMessage(buffer);
      } catch (error) {
        // Invalid framing desyncs the stream; discard the buffer so a later
        // valid frame is not wedged behind the unrecoverable bytes.
        buffer = new Uint8Array(0);
        throw error;
      }
      buffer = new Uint8Array(result.remainingBuffer);
      return result.message;
    },

    clear() {
      buffer = new Uint8Array(0);
    },
  };
}
