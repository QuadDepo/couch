import { writeFile } from "node:fs";
import { logger } from "../../utils/logger";

import {
  getKeyFilePath,
  PAIRING_MANIFEST,
  URI_POINTER_INPUT,
  WEBSOCKET_PORT,
  WEBSOCKET_SSL_PORT,
} from "./protocol";

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RECONNECT_MS = 5000;
const LOG_TRUNCATE_LENGTH = 200;

export interface WebOSConnection {
  connect(options?: WebOSRequestOptions): Promise<void>;
  disconnect(): void;
  request<T>(uri: string, payload?: object, options?: WebOSRequestOptions): Promise<T>;
  // biome-ignore lint/suspicious/noExplicitAny: WebOS subscription payloads have dynamic shapes that vary by URI
  subscribe(uri: string, payload: object, callback: (data: any) => void): Promise<void>;
  getInputSocket(options?: WebOSRequestOptions): Promise<RemoteInputSocket>;
  // biome-ignore lint/suspicious/noExplicitAny: Event callbacks have varying argument types per event
  on(event: ConnectionEvent, callback: (...args: any[]) => void): void;
  isConnected(): boolean;
  isPaired(): boolean;
  getClientKey(): string | undefined;
}

export interface WebOSRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type ConnectionEvent = "connect" | "close" | "error" | "prompt" | "message";

export interface RemoteInputSocket {
  send(type: string, payload?: object): void;
  close(): void;
}

interface WebOSRequestMessage {
  id: string;
  type: "register" | "request" | "subscribe";
  uri?: string;
  payload?: object;
}

interface WebOSResponseMessage {
  id: string;
  type?: "registered" | "response" | "purchased";
  payload?: Record<string, unknown>;
  "client-key"?: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  abort?: () => void;
}

interface ConnectionConfig {
  ip: string;
  mac: string;
  clientKey?: string;
  timeout?: number;
  reconnect?: number;
  useSsl?: boolean;
}

export function createWebOSConnection(config: ConnectionConfig): WebOSConnection {
  const ip = config.ip;
  const mac = config.mac;
  const timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;

  let ws: WebSocket | null = null;
  let connected = false;
  let paired = !!config.clientKey;
  let clientKey = config.clientKey;
  const useSsl = config.useSsl ?? false;
  let autoReconnect = config.reconnect ?? DEFAULT_RECONNECT_MS;
  let inputSocket: RemoteInputSocket | null = null;

  // Request ID generator - format matches homebridge-webos-tv for compatibility
  let cidCount = 0;
  const cidPrefix = `0000000${Math.floor(Math.random() * 0xffffffff).toString(16)}`.slice(-8);

  function getCid(): string {
    return cidPrefix + `000${(cidCount++).toString(16)}`.slice(-4);
  }

  const pendingRequests = new Map<string, PendingRequest>();
  // biome-ignore lint/suspicious/noExplicitAny: WebOS subscription payloads have dynamic shapes that vary by URI
  const subscriptions = new Map<string, (data: any) => void>();

  // biome-ignore lint/suspicious/noExplicitAny: Event callbacks have varying argument types per event
  const listeners: Map<ConnectionEvent, Set<(...args: any[]) => void>> = new Map([
    ["connect", new Set()],
    ["close", new Set()],
    ["error", new Set()],
    ["prompt", new Set()],
    ["message", new Set()],
  ]);

  function emit(event: ConnectionEvent, ...args: unknown[]): void {
    const callbacks = listeners.get(event);
    if (callbacks) {
      for (const cb of callbacks) {
        cb(...args);
      }
    }
  }

  function getUrl(): string {
    const scheme = useSsl ? "wss" : "ws";
    const port = useSsl ? WEBSOCKET_SSL_PORT : WEBSOCKET_PORT;
    return `${scheme}://${ip}:${port}`;
  }

  async function connect(options: WebOSRequestOptions = {}): Promise<void> {
    if (options.signal?.aborted) {
      throw options.signal.reason instanceof Error
        ? options.signal.reason
        : new Error("Operation cancelled");
    }
    if (connected && paired) {
      logger.debug("WebOS", "Already connected and paired");
      return;
    }

    const url = getUrl();
    const hasInitialKey = !!clientKey;
    logger.info("WebOS", `Connecting to ${url} (timeout: ${timeout}ms, hasKey: ${hasInitialKey})`);
    emit("message", `Connecting to ${ip}...`);

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let suppressReconnect = false;
      const connectTimeout = setTimeout(() => {
        suppressReconnect = true;
        ws?.close();
        options.signal?.removeEventListener("abort", abort);
        if (!settled) {
          settled = true;
          reject(new Error("Connection timeout"));
        }
      }, options.timeoutMs ?? timeout);
      const abort = () => {
        suppressReconnect = true;
        ws?.close();
        clearTimeout(connectTimeout);
        options.signal?.removeEventListener("abort", abort);
        if (!settled) {
          settled = true;
          reject(
            options.signal?.reason instanceof Error
              ? options.signal.reason
              : new Error("Operation cancelled"),
          );
        }
      };
      const cleanup = () => {
        clearTimeout(connectTimeout);
        options.signal?.removeEventListener("abort", abort);
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      try {
        ws = new WebSocket(url, {
          tls: {
            rejectUnauthorized: false,
          },
        });

        ws.addEventListener("open", async () => {
          logger.info("WebOS", "WebSocket connection opened, starting registration");
          connected = true;
          try {
            await register(options);
          } catch (err) {
            logger.error("WebOS", `Registration failed: ${err}`);
            if (!settled) {
              settled = true;
              cleanup();
              suppressReconnect = true;
              ws?.close();
              reject(err);
            }
            return;
          }

          if (!settled) {
            settled = true;
            cleanup();
            resolve();
          }
        });

        ws.addEventListener("message", (event) => {
          logger.debug("WebOS", `Received message: ${event.data}`);
          handleMessage(event.data);
        });

        ws.addEventListener("close", (event) => {
          logger.info("WebOS", `WebSocket closed: code=${event.code} reason="${event.reason}"`);
          connected = false;
          paired = false;

          if (!settled) {
            settled = true;
            cleanup();
            reject(new Error(`Connection closed: code=${event.code}`));
          }

          pendingRequests.forEach((req) => {
            clearTimeout(req.timeoutId);
            req.reject(new Error("Connection closed"));
          });
          pendingRequests.clear();

          emit("close", event);

          if (!suppressReconnect && autoReconnect > 0) {
            setTimeout(() => {
              if (!connected && autoReconnect > 0) {
                logger.info("WebOS", "Attempting auto-reconnect");
                connect().catch((err) => {
                  logger.error("WebOS", `Reconnect failed: ${err}`);
                });
              }
            }, autoReconnect);
          }
        });

        ws.addEventListener("error", (error) => {
          logger.error("WebOS", `WebSocket error: ${error}`);
          emit("error", error);
          if (!settled) {
            settled = true;
            cleanup();
            reject(error instanceof Error ? error : new Error("WebSocket connection failed"));
          }
        });
      } catch (error) {
        logger.error("WebOS", `Failed to create WebSocket: ${error}`);
        cleanup();
        if (!settled) {
          settled = true;
          reject(error);
        }
      }
    });
  }

  function disconnect(): void {
    autoReconnect = 0;
    if (ws) {
      ws.close();
      ws = null;
    }
    if (inputSocket) {
      inputSocket.close();
      inputSocket = null;
    }
    connected = false;
    paired = false;
  }

  function resolvePendingRequest(id: string, value: unknown): void {
    const req = pendingRequests.get(id);
    if (req) {
      clearTimeout(req.timeoutId);
      pendingRequests.delete(id);
      req.resolve(value);
    }
  }

  function rejectPendingRequest(id: string, error: Error): void {
    const req = pendingRequests.get(id);
    if (req) {
      clearTimeout(req.timeoutId);
      pendingRequests.delete(id);
      req.reject(error);
    }
  }

  function handleRegisteredMessage(message: WebOSResponseMessage): void {
    const receivedClientKey = message.payload?.["client-key"] as string | undefined;
    logger.debug(
      "WebOS",
      `Registered message - has client-key: ${!!receivedClientKey}, payload keys: ${message.payload ? Object.keys(message.payload).join(", ") : "none"}`,
    );

    if (!receivedClientKey) {
      // Unexpected: "registered" message should always contain client-key
      // The pairing prompt is sent via "response" type with pairingType: "PROMPT"
      logger.error(
        "WebOS",
        "Received 'registered' message without client-key - unexpected protocol state",
      );
      resolvePendingRequest(message.id, message);
      return;
    }

    clientKey = receivedClientKey;
    paired = true;
    logger.info("WebOS", "Pairing successful - received client key");

    const keyPath = getKeyFilePath(ip, mac);
    writeFile(keyPath, clientKey, (err) => {
      if (err) {
        logger.error("WebOS", `Failed to save client key: ${err}`);
      } else {
        logger.info("WebOS", `Client key saved to ${keyPath}`);
      }
    });

    resolvePendingRequest(message.id, message);
    emit("connect");
  }

  function handleResponseMessage(message: WebOSResponseMessage): void {
    const payload = message.payload;

    // Check if this is a pairing prompt response (TV is showing the accept/deny dialog)
    if (payload?.pairingType === "PROMPT" && payload.returnValue === true) {
      logger.info("WebOS", "Pairing prompt displayed on TV - waiting for user confirmation");
      emit("prompt");
      resolvePendingRequest(message.id, payload);
      return;
    }

    if (pendingRequests.has(message.id)) {
      if (payload && typeof payload === "object") {
        if (payload.errorCode || payload.errorText || !payload.returnValue) {
          rejectPendingRequest(
            message.id,
            new Error(
              `Request failed: ${payload.errorText || payload.errorCode || "Unknown error"}`,
            ),
          );
          return;
        }
      }
      resolvePendingRequest(message.id, payload);
      return;
    }

    const callback = subscriptions.get(message.id);
    if (callback && message.payload) {
      callback(message.payload);
    }
  }

  function handleMessage(data: string | Buffer): void {
    let message: WebOSResponseMessage;

    try {
      message = JSON.parse(data.toString());
    } catch {
      logger.error("WebOS", `JSON parse error: ${data}`);
      return;
    }

    logger.debug("WebOS", `Handling message type="${message.type}" id="${message.id}"`);
    emit("message", message);

    switch (message.type) {
      case "registered":
        handleRegisteredMessage(message);
        break;
      default:
        handleResponseMessage(message);
        break;
    }
  }

  async function register(options: WebOSRequestOptions = {}): Promise<void> {
    const cid = getCid();
    const manifest = { ...PAIRING_MANIFEST };
    // biome-ignore lint/suspicious/noExplicitAny: PAIRING_MANIFEST is a const with RSA signature; client-key must be added dynamically
    (manifest as any)["client-key"] = clientKey;

    const message: WebOSRequestMessage = {
      id: cid,
      type: "register",
      payload: manifest,
    };

    logger.info("WebOS", `Sending registration request (id: ${cid}, hasKey: ${!!clientKey})`);

    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pendingRequests.delete(cid);
        options.signal?.removeEventListener("abort", abort);
        logger.error("WebOS", `Registration timeout after ${timeout}ms`);
        reject(new Error("Registration timeout"));
      }, options.timeoutMs ?? timeout);

      const abort = () => {
        pendingRequests.delete(cid);
        clearTimeout(timeoutId);
        reject(
          options.signal?.reason instanceof Error
            ? options.signal.reason
            : new Error("Operation cancelled"),
        );
      };
      if (options.signal?.aborted) {
        abort();
        return;
      }
      options.signal?.addEventListener("abort", abort, { once: true });

      pendingRequests.set(cid, {
        resolve: () => {
          clearTimeout(timeoutId);
          options.signal?.removeEventListener("abort", abort);
          logger.info("WebOS", "Registration completed successfully");
          resolve();
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          options.signal?.removeEventListener("abort", abort);
          logger.error("WebOS", `Registration rejected: ${error}`);
          reject(error);
        },
        timeoutId,
        abort,
      });

      try {
        sendMessage(message);
      } catch (error) {
        rejectPendingRequest(cid, error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async function request<T>(
    uri: string,
    payload: object = {},
    options: WebOSRequestOptions = {},
  ): Promise<T> {
    if (!connected) {
      throw new Error("Not connected");
    }

    const cid = getCid();
    const message: WebOSRequestMessage = {
      id: cid,
      type: "request",
      uri,
      payload,
    };

    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pendingRequests.delete(cid);
        options.signal?.removeEventListener("abort", abort);
        reject(new Error("Request timeout"));
      }, options.timeoutMs ?? timeout);

      const abort = () => {
        pendingRequests.delete(cid);
        clearTimeout(timeoutId);
        reject(
          options.signal?.reason instanceof Error
            ? options.signal.reason
            : new Error("Operation cancelled"),
        );
      };
      if (options.signal?.aborted) {
        abort();
        return;
      }
      options.signal?.addEventListener("abort", abort, { once: true });

      pendingRequests.set(cid, {
        resolve: (value) => {
          clearTimeout(timeoutId);
          options.signal?.removeEventListener("abort", abort);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          options.signal?.removeEventListener("abort", abort);
          reject(error);
        },
        timeoutId,
        abort,
      });

      try {
        sendMessage(message);
      } catch (error) {
        rejectPendingRequest(cid, error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async function subscribe(
    uri: string,
    payload: object,
    // biome-ignore lint/suspicious/noExplicitAny: WebOS subscription payloads have dynamic shapes that vary by URI
    callback: (data: any) => void,
  ): Promise<void> {
    if (!connected) {
      throw new Error("Not connected");
    }

    const cid = getCid();
    const message: WebOSRequestMessage = {
      id: cid,
      type: "subscribe",
      uri,
      payload,
    };

    subscriptions.set(cid, callback);
    try {
      sendMessage(message);
    } catch (error) {
      subscriptions.delete(cid);
      throw error;
    }
  }

  function sendMessage(message: WebOSRequestMessage): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      logger.error("WebOS", "Cannot send message: WebSocket not connected");
      throw new Error("WebSocket not connected");
    }

    const payload = JSON.stringify(message);
    const truncated = payload.length > LOG_TRUNCATE_LENGTH;
    logger.debug(
      "WebOS",
      `Sending: ${payload.substring(0, LOG_TRUNCATE_LENGTH)}${truncated ? "..." : ""}`,
    );
    ws.send(payload);
  }

  async function getInputSocket(options?: WebOSRequestOptions): Promise<RemoteInputSocket> {
    if (inputSocket) {
      return inputSocket;
    }

    const data = await request<{ socketPath: string }>(URI_POINTER_INPUT, {}, options);

    if (!data.socketPath) {
      throw new Error("No socket path in response");
    }

    // socketPath may be a full URL or just a path
    const socketUrl =
      data.socketPath.startsWith("ws://") || data.socketPath.startsWith("wss://")
        ? data.socketPath
        : `${useSsl ? "wss" : "ws"}://${ip}:${useSsl ? WEBSOCKET_SSL_PORT : WEBSOCKET_PORT}${data.socketPath}`;

    logger.info("WebOS", `Connecting to input socket: ${data.socketPath}`);

    return new Promise<RemoteInputSocket>((resolve, reject) => {
      const socketWs = new WebSocket(socketUrl, {
        tls: {
          rejectUnauthorized: false,
        },
      });
      let settled = false;
      const timeoutId = setTimeout(() => {
        fail(new Error("Input socket timeout"));
      }, options?.timeoutMs ?? timeout);
      const cleanup = () => {
        clearTimeout(timeoutId);
        options?.signal?.removeEventListener("abort", abort);
        socketWs.removeEventListener("open", onOpen);
        socketWs.removeEventListener("error", onError);
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        try {
          socketWs.close();
        } catch {
          // The socket may have failed before it became closable.
        }
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      const abort = () =>
        fail(
          options?.signal?.reason instanceof Error
            ? options.signal.reason
            : new Error("Operation cancelled"),
        );
      const onOpen = () => {
        if (settled) return;
        settled = true;
        cleanup();
        logger.info("WebOS", "Input socket connected");

        const remoteSocket: RemoteInputSocket = {
          send(type: string, payload: object = {}) {
            if (socketWs.readyState !== WebSocket.OPEN) {
              throw new Error("Input socket is not connected");
            }
            const message = `${Object.entries(payload)
              .map(([k, v]) => `${k}:${v}`)
              .join("\n")}\ntype:${type}\n\n`;
            socketWs.send(message);
          },
          close() {
            socketWs.close();
            inputSocket = null;
          },
        };

        inputSocket = remoteSocket;
        resolve(remoteSocket);
      };
      const onError = (error: unknown) => {
        logger.error("WebOS", `Input socket error: ${error}`);
        fail(error);
      };
      socketWs.addEventListener("open", onOpen);
      socketWs.addEventListener("error", onError);
      if (options?.signal?.aborted) abort();
      else options?.signal?.addEventListener("abort", abort, { once: true });
    });
  }

  return {
    connect,
    disconnect,
    request,
    subscribe,
    getInputSocket,
    // biome-ignore lint/suspicious/noExplicitAny: Event callbacks have varying argument types per event
    on(event: ConnectionEvent, callback: (...args: any[]) => void) {
      listeners.get(event)?.add(callback);
      return () => {
        listeners.get(event)?.delete(callback);
      };
    },
    isConnected: () => connected,
    isPaired: () => paired,
    getClientKey: () => clientKey,
  };
}
