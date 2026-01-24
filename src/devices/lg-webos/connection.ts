import { existsSync, readFile, writeFile } from "node:fs";
import { logger } from "../../utils/logger";
import {
  getKeyFilePath,
  PAIRING_MANIFEST,
  URI_POINTER_INPUT,
  WEBSOCKET_PORT,
  WEBSOCKET_SSL_PORT,
} from "./protocol";

export interface WebOSConnection {
  connect(): Promise<void>;
  disconnect(): void;
  request<T>(uri: string, payload?: object): Promise<T>;
  subscribe(
    uri: string,
    payload: object,
    callback: (data: Record<string, unknown>) => void,
  ): Promise<void>;
  getInputSocket(): Promise<RemoteInputSocket>;
  on(event: ConnectionEvent, callback: (...args: unknown[]) => void): void;
  isConnected(): boolean;
  isPaired(): boolean;
  getClientKey(): string | undefined;
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
  timeout: ReturnType<typeof setTimeout>;
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
  const timeout = config.timeout ?? 15000;
  let useSsl = config.useSsl ?? false;

  let ws: WebSocket | null = null;
  let connected = false;
  let paired = !!config.clientKey;
  let clientKey = config.clientKey;
  let autoReconnect = config.reconnect ?? 5000;
  let inputSocket: RemoteInputSocket | null = null;
  let sslFallbackAttempted = false;

  // Request ID generator - format matches homebridge-webos-tv for compatibility
  let cidCount = 0;
  const cidPrefix = `0000000${Math.floor(Math.random() * 0xffffffff).toString(16)}`.slice(-8);

  function getCid(): string {
    return cidPrefix + `000${(cidCount++).toString(16)}`.slice(-4);
  }

  const pendingRequests = new Map<string, PendingRequest>();
  const subscriptions = new Map<string, (data: Record<string, unknown>) => void>();

  const listeners: Map<ConnectionEvent, Set<(...args: unknown[]) => void>> = new Map([
    ["connect", new Set()],
    ["close", new Set()],
    ["error", new Set()],
    ["prompt", new Set()],
    ["message", new Set()],
  ]);

  function emit(event: ConnectionEvent, ...args: unknown[]): void {
    const eventListeners = listeners.get(event);
    if (eventListeners) {
      for (const cb of eventListeners) {
        cb(...args);
      }
    }
  }

  function getUrl(): string {
    const scheme = useSsl ? "wss" : "ws";
    const port = useSsl ? WEBSOCKET_SSL_PORT : WEBSOCKET_PORT;
    return `${scheme}://${ip}:${port}`;
  }

  async function connect(): Promise<void> {
    if (connected && paired) {
      logger.debug("WebOS", "Already connected and paired");
      return;
    }

    const url = getUrl();
    const hasInitialKey = !!clientKey;
    logger.info("WebOS", `Connecting to ${url} (timeout: ${timeout}ms, hasKey: ${hasInitialKey})`);
    emit("message", `Connecting to ${ip}...`);

    return new Promise<void>((resolve, reject) => {
      try {
        ws = new WebSocket(url, {
          tls: {
            rejectUnauthorized: false,
          },
        });

        let resolved = false;

        ws.addEventListener("open", async () => {
          logger.info("WebOS", "WebSocket connection opened, starting registration");
          connected = true;
          try {
            await register();
          } catch (err) {
            logger.error("WebOS", `Registration failed: ${err}`);
            if (!resolved) {
              resolved = true;
              reject(err);
            }
            return;
          }

          if (!resolved) {
            resolved = true;
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

          pendingRequests.forEach((req) => {
            clearTimeout(req.timeout);
            req.reject(new Error("Connection closed"));
          });
          pendingRequests.clear();

          emit("close", event);

          // Reject the connect promise if we closed before successfully connecting
          if (!resolved) {
            resolved = true;
            reject(new Error(`Connection failed: code=${event.code}`));
            return;
          }

          if (autoReconnect > 0) {
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

          // Some WebOS TVs require SSL; try SSL fallback on connection errors
          if (!useSsl && !sslFallbackAttempted) {
            logger.info("WebOS", "Connection error - retrying with SSL");
            useSsl = true;
            sslFallbackAttempted = true;
            setTimeout(() => connect().catch(() => {}), 1000);
            return;
          }

          emit("error", error);
        });
      } catch (error) {
        logger.error("WebOS", `Failed to create WebSocket: ${error}`);
        reject(error);
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

    if (message.type === "registered") {
      // WebOS sends client-key in payload, not at top level
      const receivedClientKey = message.payload?.["client-key"] as string | undefined;
      logger.debug(
        "WebOS",
        `Registered message - has client-key: ${!!receivedClientKey}, payload keys: ${message.payload ? Object.keys(message.payload).join(", ") : "none"}`,
      );
      if (receivedClientKey) {
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

        const req = pendingRequests.get(message.id);
        if (req) {
          clearTimeout(req.timeout);
          pendingRequests.delete(message.id);
          req.resolve(message);
        }

        emit("connect");
      } else {
        // User must confirm on TV screen
        logger.info("WebOS", "Pairing prompt sent - waiting for user confirmation on TV");
        emit("prompt");

        const req = pendingRequests.get(message.id);
        if (req) {
          clearTimeout(req.timeout);
          pendingRequests.delete(message.id);
          req.resolve(message);
        }
      }
      return;
    }

    const req = pendingRequests.get(message.id);
    if (req) {
      clearTimeout(req.timeout);
      pendingRequests.delete(message.id);

      if (message.payload && typeof message.payload === "object") {
        const payload = message.payload;
        const errorCode = payload.errorCode as string | undefined;
        const errorText = payload.errorText as string | undefined;
        const returnValue = payload.returnValue as boolean | undefined;
        if (errorCode || errorText || returnValue === false) {
          req.reject(new Error(`Request failed: ${errorText || errorCode || "Unknown error"}`));
          return;
        }
      }

      req.resolve(message.payload);
      return;
    }

    if (message.id && subscriptions.has(message.id)) {
      const callback = subscriptions.get(message.id);
      if (callback && message.payload) {
        callback(message.payload);
      }
    }
  }

  async function register(): Promise<void> {
    const cid = getCid();
    const manifest: typeof PAIRING_MANIFEST & { "client-key"?: string } = {
      ...PAIRING_MANIFEST,
      "client-key": clientKey,
    };

    const message: WebOSRequestMessage = {
      id: cid,
      type: "register",
      payload: manifest,
    };

    logger.info("WebOS", `Sending registration request (id: ${cid}, hasKey: ${!!clientKey})`);

    return new Promise<void>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        pendingRequests.delete(cid);
        logger.error("WebOS", `Registration timeout after ${timeout}ms`);
        reject(new Error("Registration timeout"));
      }, timeout);

      pendingRequests.set(cid, {
        resolve: () => {
          clearTimeout(timeoutHandle);
          logger.info("WebOS", "Registration completed successfully");
          resolve();
        },
        reject: (error) => {
          clearTimeout(timeoutHandle);
          logger.error("WebOS", `Registration rejected: ${error}`);
          reject(error);
        },
        timeout: timeoutHandle,
      });

      sendMessage(message);
    });
  }

  async function request<T>(uri: string, payload: object = {}): Promise<T> {
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
      const timeoutHandle = setTimeout(() => {
        pendingRequests.delete(cid);
        reject(new Error("Request timeout"));
      }, timeout);

      pendingRequests.set(cid, {
        resolve: (value) => {
          clearTimeout(timeoutHandle);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timeoutHandle);
          reject(error);
        },
        timeout: timeoutHandle,
      });

      sendMessage(message);
    });
  }

  async function subscribe(
    uri: string,
    payload: object,
    callback: (data: Record<string, unknown>) => void,
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
    sendMessage(message);
  }

  function sendMessage(message: WebOSRequestMessage): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      logger.error("WebOS", "Cannot send message: WebSocket not connected");
      throw new Error("WebSocket not connected");
    }

    const payload = JSON.stringify(message);
    logger.debug(
      "WebOS",
      `Sending: ${payload.substring(0, 200)}${payload.length > 200 ? "..." : ""}`,
    );
    ws.send(payload);
  }

  async function getInputSocket(): Promise<RemoteInputSocket> {
    if (inputSocket) {
      return inputSocket;
    }

    const data = await request<{ socketPath: string }>(URI_POINTER_INPUT);

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

      socketWs.addEventListener("open", () => {
        logger.info("WebOS", "Input socket connected");

        const remoteSocket: RemoteInputSocket = {
          send(type: string, payload: object = {}) {
            // Input socket uses key:value format, not JSON
            const message = `${Object.entries(payload)
              .map(([k, v]) => `${k}:${v}`)
              .join("\n")}\ntype:${type}\n\n`;

            if (socketWs.readyState === WebSocket.OPEN) {
              socketWs.send(message);
            }
          },
          close() {
            socketWs.close();
            inputSocket = null;
          },
        };

        inputSocket = remoteSocket;
        resolve(remoteSocket);
      });

      socketWs.addEventListener("error", (error) => {
        logger.error("WebOS", `Input socket error: ${error}`);
        reject(error);
      });
    });
  }

  return {
    connect,
    disconnect,
    request,
    subscribe,
    getInputSocket,
    on(event: ConnectionEvent, callback: (...args: unknown[]) => void) {
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

export async function loadClientKey(ip: string, mac: string): Promise<string | undefined> {
  const keyPath = getKeyFilePath(ip, mac);

  return new Promise((resolve) => {
    readFile(keyPath, "utf-8", (err, data) => {
      if (err) {
        resolve(undefined);
      } else {
        resolve(data.trim());
      }
    });
  });
}

export function hasStoredKey(ip: string, mac: string): boolean {
  return existsSync(getKeyFilePath(ip, mac));
}
