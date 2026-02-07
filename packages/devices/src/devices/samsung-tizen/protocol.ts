import { APP_NAME } from "../../constants/app";

const WEBSOCKET_PORT = 8001;
const WEBSOCKET_SSL_PORT = 8002;

const APP_NAME_BASE64 = btoa(APP_NAME);

export function buildWsUrl(ip: string, token?: string): string {
  const base = `wss://${ip}:${WEBSOCKET_SSL_PORT}/api/v2/channels/samsung.remote.control?name=${APP_NAME_BASE64}`;
  return token ? `${base}&token=${token}` : base;
}

export function buildKeyCommand(key: string): string {
  return JSON.stringify({
    method: "ms.remote.control",
    params: {
      Cmd: "Click",
      DataOfCmd: key,
      TypeOfRemote: "SendRemoteKey",
    },
  });
}

export function buildTextCommand(text: string): string {
  let encodedText: string;
  try {
    encodedText = btoa(text);
  } catch {
    // btoa() fails on non-Latin1 characters (emoji, non-ASCII Unicode).
    // Encode as UTF-8 bytes first, then convert to base64.
    const utf8Bytes = new TextEncoder().encode(text);
    encodedText = btoa(String.fromCharCode(...utf8Bytes));
  }

  return JSON.stringify({
    method: "ms.remote.control",
    params: {
      Cmd: encodedText,
      TypeOfRemote: "SendInputString",
      DataOfCmd: "base64",
    },
  });
}

export function buildTextEndCommand(): string {
  return JSON.stringify({
    method: "ms.remote.control",
    params: {
      TypeOfRemote: "SendInputEnd",
    },
  });
}

export function buildDeviceInfoUrl(ip: string): string {
  return `http://${ip}:${WEBSOCKET_PORT}/api/v2/`;
}
