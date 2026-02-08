import { decodeVarint, encodeVarint } from "./framing";
import {
  EncodingType,
  PairingConfiguration,
  PairingEncoding,
  PairingMessageType,
  PairingOption,
  PairingRequest,
  PairingSecret,
  PROTOCOL_VERSION,
  RemoteConfigure,
  RemoteDirection,
  RemoteImeBatchEdit,
  RemoteKeyInject,
  RemoteMessageType,
  RemotePing,
  RoleType,
  STATUS_OK,
} from "./schema";

const WIRE_VARINT = 0;
const WIRE_LENGTH_DELIMITED = 2;

// Protobuf field tag: field number in upper bits, wire type in lower 3 bits
function fieldTag(fieldNumber: number, wireType: number): number {
  return (fieldNumber << 3) | wireType;
}

function encodeVarintField(fieldNumber: number, value: number): Uint8Array {
  const tag = encodeVarint(fieldTag(fieldNumber, WIRE_VARINT));
  const val = encodeVarint(value);
  const result = new Uint8Array(tag.length + val.length);
  result.set(tag, 0);
  result.set(val, tag.length);
  return result;
}

function encodeBytesField(fieldNumber: number, data: Uint8Array): Uint8Array {
  const tag = encodeVarint(fieldTag(fieldNumber, WIRE_LENGTH_DELIMITED));
  const length = encodeVarint(data.length);
  const result = new Uint8Array(tag.length + length.length + data.length);
  result.set(tag, 0);
  result.set(length, tag.length);
  result.set(data, tag.length + length.length);
  return result;
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// Envelope uses overlapping field numbers with different wire types,
// so we encode it manually instead of using protobufjs
function wrapMessage(messageType: number, payload: Uint8Array): Uint8Array {
  return concat(
    encodeVarintField(1, PROTOCOL_VERSION),
    encodeVarintField(2, STATUS_OK),
    encodeBytesField(messageType, payload),
  );
}

export function buildPairingRequest(clientName: string, serviceName: string): Uint8Array {
  const message = PairingRequest.create({ serviceName, clientName });
  const payload = PairingRequest.encode(message).finish();
  return wrapMessage(PairingMessageType.PAIRING_REQUEST, payload);
}

export function buildOptions(): Uint8Array {
  const encoding = PairingEncoding.create({
    type: EncodingType.HEXADECIMAL,
    symbolLength: 6,
  });
  const message = PairingOption.create({
    inputEncodings: [encoding],
    preferredRole: RoleType.INPUT,
  });
  const payload = PairingOption.encode(message).finish();
  return wrapMessage(PairingMessageType.OPTIONS, payload);
}

export function buildConfiguration(): Uint8Array {
  const encoding = PairingEncoding.create({
    type: EncodingType.HEXADECIMAL,
    symbolLength: 6,
  });
  const message = PairingConfiguration.create({
    encoding,
    clientRole: RoleType.INPUT,
  });
  const payload = PairingConfiguration.encode(message).finish();
  return wrapMessage(PairingMessageType.CONFIGURATION, payload);
}

export function buildSecret(secret: Uint8Array): Uint8Array {
  const message = PairingSecret.create({ secret });
  const payload = PairingSecret.encode(message).finish();
  return wrapMessage(PairingMessageType.SECRET, payload);
}

export function buildRemoteConfiguration(
  model: string,
  vendor: string,
  packageName: string,
): Uint8Array {
  const message = RemoteConfigure.create({
    code1: 622, // Protocol-required device class identifier
    deviceInfo: {
      model,
      vendor,
      unknown1: 1,
      unknown2: "1",
      packageName,
      appVersion: "1.0.0",
    },
  });
  const payload = RemoteConfigure.encode(message).finish();
  return wrapMessage(RemoteMessageType.REMOTE_CONFIGURE, payload);
}

export function buildKeyInject(
  keyCode: number,
  direction: RemoteDirection = RemoteDirection.SHORT,
): Uint8Array {
  const message = RemoteKeyInject.create({ keyCode, direction });
  const payload = RemoteKeyInject.encode(message).finish();
  return wrapMessage(RemoteMessageType.KEY_INJECT, payload);
}

export function buildTextInput(
  text: string,
  imeCounter: number = 0,
  fieldCounter: number = 0,
): Uint8Array {
  // Cursor position after insertion (0-indexed, so length-1)
  const textLen = text.length > 0 ? text.length - 1 : 0;
  const message = RemoteImeBatchEdit.create({
    imeCounter,
    fieldCounter,
    editInfo: [
      {
        insert: 1,
        textFieldStatus: {
          start: textLen,
          end: textLen,
          value: text,
        },
      },
    ],
  });
  const payload = RemoteImeBatchEdit.encode(message).finish();
  return wrapMessage(RemoteMessageType.IME_BATCH_EDIT, payload);
}

export function buildPingRequest(): Uint8Array {
  const message = RemotePing.create({ val1: 0 });
  const payload = RemotePing.encode(message).finish();
  return wrapMessage(RemoteMessageType.PING_REQUEST, payload);
}

export function buildPingResponse(): Uint8Array {
  const message = RemotePing.create({ val1: 0 });
  const payload = RemotePing.encode(message).finish();
  return wrapMessage(RemoteMessageType.PING_RESPONSE, payload);
}

export interface ParsedMessage {
  protocolVersion: number;
  status: number;
  type: number;
  payload: Uint8Array;
}

export function parseMessage(data: Uint8Array): ParsedMessage | null {
  let offset = 0;
  let protocolVersion = 0;
  let status = 0;
  let type = 0;
  let payload = new Uint8Array(0);

  try {
    while (offset < data.length) {
      const { value: tag, bytesRead: tagBytes } = decodeVarint(data, offset);
      offset += tagBytes;

      // Reverse of fieldTag(): extract field number and wire type from tag
      const fieldNumber = tag >> 3;
      const wireType = tag & 0x07;

      if (wireType === WIRE_VARINT) {
        const { value, bytesRead } = decodeVarint(data, offset);
        offset += bytesRead;

        if (fieldNumber === 1) protocolVersion = value;
        else if (fieldNumber === 2) status = value;
      } else if (wireType === WIRE_LENGTH_DELIMITED) {
        const { value: length, bytesRead: lengthBytes } = decodeVarint(data, offset);
        offset += lengthBytes;

        const fieldData = data.slice(offset, offset + length);
        offset += length;

        if (fieldNumber >= 1 && fieldNumber <= 100) {
          type = fieldNumber;
          payload = fieldData;
        }
      } else {
        return null;
      }
    }
  } catch {
    return null;
  }

  return { protocolVersion, status, type, payload };
}

export function parseSecretPayload(payload: Uint8Array): Uint8Array | null {
  try {
    const message = PairingSecret.decode(payload);
    const obj = PairingSecret.toObject(message) as { secret?: Uint8Array };
    if (obj.secret instanceof Uint8Array) {
      return obj.secret;
    }
    return null;
  } catch {
    return null;
  }
}

export interface ImeBatchEditInfo {
  imeCounter: number;
  fieldCounter: number;
}

export function parseImeBatchEdit(payload: Uint8Array): ImeBatchEditInfo | null {
  try {
    const message = RemoteImeBatchEdit.decode(payload);
    const obj = RemoteImeBatchEdit.toObject(message) as {
      imeCounter?: number;
      fieldCounter?: number;
    };
    return {
      imeCounter: obj.imeCounter ?? 0,
      fieldCounter: obj.fieldCounter ?? 0,
    };
  } catch {
    return null;
  }
}
