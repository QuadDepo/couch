import { logger } from "../../utils/logger";
import { createConnectionEvents } from "../shared/connectionEvents";
import { cancellationError } from "./cancellation";
import type {
  ConnectionConfig,
  ConnectionEvent,
  RemoteInputSocket,
  WebOSConnection,
  WebOSRequestMessage,
  WebOSRequestOptions,
} from "./connectionTypes";
import { openPointerInput } from "./pointerInput";
import { URI_POINTER_INPUT, WEBSOCKET_PORT, WEBSOCKET_SSL_PORT } from "./protocol";
import { createRequestChannel } from "./requestChannel";

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RECONNECT_MS = 5000;

function parseSocketPath(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const value = (payload as Record<string, unknown>).socketPath;
    if (typeof value === "string") return value;
  }
  throw new Error("No socket path in response");
}

export function createWebOSConnection(config: ConnectionConfig): WebOSConnection {
  const timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;
  const useSsl = config.useSsl ?? false;
  let webSocket: WebSocket | null = null;
  let inputSocket: RemoteInputSocket | null = null;
  let connected = false;
  let paired = !!config.clientKey;
  let clientKey = config.clientKey;
  let autoReconnect = config.reconnect ?? DEFAULT_RECONNECT_MS;
  const events = createConnectionEvents<ConnectionEvent>([
    "connect",
    "close",
    "error",
    "prompt",
    "message",
  ]);

  const channel = createRequestChannel({
    ip: config.ip,
    mac: config.mac,
    timeout,
    getClientKey: () => clientKey,
    setClientKey: (value) => {
      clientKey = value;
      paired = true;
    },
    emit: events.emit,
    send(message: WebOSRequestMessage) {
      if (!webSocket || webSocket.readyState !== WebSocket.OPEN) {
        throw new Error("WebSocket not connected");
      }
      webSocket.send(JSON.stringify(message));
    },
  });

  const url = () =>
    `${useSsl ? "wss" : "ws"}://${config.ip}:${useSsl ? WEBSOCKET_SSL_PORT : WEBSOCKET_PORT}`;

  async function connect(options: WebOSRequestOptions = {}): Promise<void> {
    if (options.signal?.aborted) throw cancellationError(options.signal);
    if (connected && paired) return;
    events.emit("message", `Connecting to ${config.ip}...`);

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let suppressReconnect = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimeout);
        options.signal?.removeEventListener("abort", abort);
        if (error) reject(error instanceof Error ? error : new Error(String(error)));
        else resolve();
      };
      const abort = () => {
        suppressReconnect = true;
        webSocket?.close();
        finish(cancellationError(options.signal));
      };
      const connectTimeout = setTimeout(() => {
        suppressReconnect = true;
        webSocket?.close();
        finish(new Error("Connection timeout"));
      }, options.timeoutMs ?? timeout);
      options.signal?.addEventListener("abort", abort, { once: true });

      try {
        webSocket = new WebSocket(url(), { tls: { rejectUnauthorized: false } });
        webSocket.addEventListener("open", async () => {
          connected = true;
          try {
            await channel.register(options);
            finish();
          } catch (error) {
            suppressReconnect = true;
            webSocket?.close();
            finish(error);
          }
        });
        webSocket.addEventListener("message", (event) => channel.handleMessage(event.data));
        webSocket.addEventListener("error", (error) => {
          events.emit("error", error);
          finish(error instanceof Error ? error : new Error("WebSocket connection failed"));
        });
        webSocket.addEventListener("close", (event) => {
          connected = false;
          paired = false;
          finish(new Error(`Connection closed: code=${event.code}`));
          channel.rejectAll(new Error("Connection closed"));
          events.emit("close", event);
          if (!suppressReconnect && autoReconnect > 0) {
            setTimeout(() => {
              if (!connected && autoReconnect > 0) {
                connect().catch((error) => logger.error("WebOS", `Reconnect failed: ${error}`));
              }
            }, autoReconnect);
          }
        });
      } catch (error) {
        finish(error);
      }
    });
  }

  function disconnect(): void {
    autoReconnect = 0;
    webSocket?.close();
    webSocket = null;
    inputSocket?.close();
    inputSocket = null;
    connected = false;
    paired = false;
  }

  function request<T>(uri: string, payload?: object, options?: WebOSRequestOptions): Promise<T> {
    if (!connected) return Promise.reject(new Error("Not connected"));
    return channel.request<T>(uri, payload, options);
  }

  function subscribe(
    uri: string,
    payload: object,
    // biome-ignore lint/suspicious/noExplicitAny: WebOS subscription payloads have dynamic shapes that vary by URI
    callback: (data: any) => void,
  ): Promise<void> {
    if (!connected) return Promise.reject(new Error("Not connected"));
    return channel.subscribe(uri, payload, callback);
  }

  async function getInputSocket(options?: WebOSRequestOptions): Promise<RemoteInputSocket> {
    if (inputSocket) return inputSocket;
    const socketPath = await channel.request(URI_POINTER_INPUT, {}, options, parseSocketPath);
    inputSocket = await openPointerInput({
      ...options,
      ip: config.ip,
      socketPath,
      timeout,
      useSsl,
      onClose: () => {
        inputSocket = null;
      },
    });
    return inputSocket;
  }

  return {
    connect,
    disconnect,
    request,
    subscribe,
    getInputSocket,
    on: events.on,
    isConnected: () => connected,
    isPaired: () => paired,
    getClientKey: () => clientKey,
  };
}
