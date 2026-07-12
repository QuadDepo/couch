import type { RemoteInputSocket, WebOSConnection } from "./connectionTypes";

export const credentials = {
  clientKey: "client-key",
  mac: "",
  useSsl: false,
  lastUpdated: "now",
};

export function fakeWebos() {
  const calls: string[] = [];
  let connected = false;
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const socket: RemoteInputSocket = {
    send: (type, payload) => calls.push(`socket:${type}:${JSON.stringify(payload)}`),
    close: () => calls.push("socket:close"),
  };
  const connection: WebOSConnection = {
    connect: async () => {
      connected = true;
      listeners.get("connect")?.();
    },
    disconnect: async () => {
      connected = false;
      calls.push("disconnect");
    },
    request: async <T>(uri: string): Promise<T> => {
      calls.push(`request:${uri}`);
      return {} as T;
    },
    subscribe: async () => undefined,
    getInputSocket: async () => socket,
    on: (event, callback) => {
      listeners.set(event, callback as (...args: unknown[]) => void);
      return () => listeners.delete(event);
    },
    isConnected: () => connected,
    isPaired: () => true,
    getClientKey: () => "client-key",
  };
  return { connection, calls };
}
