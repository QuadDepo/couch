import protobuf from "protobufjs";

export const PAIRING_PORT = 6467;
export const REMOTE_PORT = 6466;
export const PROTOCOL_VERSION = 2;
export const STATUS_OK = 200;

export enum PairingMessageType {
  PAIRING_REQUEST = 10,
  PAIRING_REQUEST_ACK = 11,
  OPTIONS = 20,
  OPTIONS_ACK = 21,
  CONFIGURATION = 30,
  CONFIGURATION_ACK = 31,
  SECRET = 40,
  SECRET_ACK = 41,
}

export enum EncodingType {
  UNKNOWN = 0,
  ALPHANUMERIC = 1,
  NUMERIC = 2,
  HEXADECIMAL = 3,
  QRCODE = 4,
}

export enum RoleType {
  UNKNOWN = 0,
  INPUT = 1,
  OUTPUT = 2,
}

const pairingSchema = {
  nested: {
    PairingEncoding: {
      fields: {
        type: { type: "int32", id: 1 },
        symbolLength: { type: "int32", id: 2 },
      },
    },
    PairingRequest: {
      fields: {
        serviceName: { type: "string", id: 1 },
        clientName: { type: "string", id: 2 },
      },
    },
    PairingOption: {
      fields: {
        inputEncodings: { type: "PairingEncoding", id: 1, rule: "repeated" },
        outputEncodings: { type: "PairingEncoding", id: 2, rule: "repeated" },
        preferredRole: { type: "int32", id: 3 },
      },
    },
    PairingConfiguration: {
      fields: {
        encoding: { type: "PairingEncoding", id: 1 },
        clientRole: { type: "int32", id: 2 },
      },
    },
    PairingSecret: {
      fields: {
        secret: { type: "bytes", id: 1 },
      },
    },
  },
};

export enum RemoteMessageType {
  REMOTE_CONFIGURE = 1,
  REMOTE_SET_ACTIVE = 2,
  REMOTE_ERROR = 3,
  PING_REQUEST = 8,
  PING_RESPONSE = 9,
  KEY_INJECT = 10,
  IME_KEY_INJECT = 20,
  IME_BATCH_EDIT = 21,
  IME_SHOW_REQUEST = 22,
  VOICE_BEGIN = 30,
  VOICE_PAYLOAD = 31,
  VOICE_END = 32,
  REMOTE_START = 40,
  SET_VOLUME_LEVEL = 50,
  ADJUST_VOLUME_LEVEL = 51,
}

export enum RemoteDirection {
  START_LONG = 1,
  END_LONG = 2,
  SHORT = 3,
}

const remoteSchema = {
  nested: {
    RemoteDeviceInfo: {
      fields: {
        model: { type: "string", id: 1 },
        vendor: { type: "string", id: 2 },
        unknown1: { type: "int32", id: 3 },
        unknown2: { type: "string", id: 4 },
        packageName: { type: "string", id: 5 },
        appVersion: { type: "string", id: 6 },
      },
    },
    RemoteConfigure: {
      fields: {
        code1: { type: "int32", id: 1 },
        deviceInfo: { type: "RemoteDeviceInfo", id: 2 },
      },
    },
    RemoteKeyInject: {
      fields: {
        keyCode: { type: "int32", id: 1 },
        direction: { type: "int32", id: 2 },
      },
    },
    RemotePing: {
      fields: {
        val1: { type: "int32", id: 1 },
      },
    },
    RemoteImeObject: {
      fields: {
        start: { type: "int32", id: 1 },
        end: { type: "int32", id: 2 },
        value: { type: "string", id: 3 },
      },
    },
    RemoteEditInfo: {
      fields: {
        insert: { type: "int32", id: 1 },
        textFieldStatus: { type: "RemoteImeObject", id: 2 },
      },
    },
    RemoteImeBatchEdit: {
      fields: {
        imeCounter: { type: "int32", id: 1 },
        fieldCounter: { type: "int32", id: 2 },
        editInfo: { type: "RemoteEditInfo", id: 3, rule: "repeated" },
      },
    },
  },
};

const pairingRoot = protobuf.Root.fromJSON(pairingSchema);
pairingRoot.resolveAll();

const remoteRoot = protobuf.Root.fromJSON(remoteSchema);
remoteRoot.resolveAll();

export const PairingEncoding = pairingRoot.lookupType("PairingEncoding");
export const PairingRequest = pairingRoot.lookupType("PairingRequest");
export const PairingOption = pairingRoot.lookupType("PairingOption");
export const PairingConfiguration = pairingRoot.lookupType("PairingConfiguration");
export const PairingSecret = pairingRoot.lookupType("PairingSecret");

export const RemoteDeviceInfo = remoteRoot.lookupType("RemoteDeviceInfo");
export const RemoteConfigure = remoteRoot.lookupType("RemoteConfigure");
export const RemoteKeyInject = remoteRoot.lookupType("RemoteKeyInject");
export const RemotePing = remoteRoot.lookupType("RemotePing");
export const RemoteImeObject = remoteRoot.lookupType("RemoteImeObject");
export const RemoteEditInfo = remoteRoot.lookupType("RemoteEditInfo");
export const RemoteImeBatchEdit = remoteRoot.lookupType("RemoteImeBatchEdit");
