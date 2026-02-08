import * as tls from "node:tls";
import { logger } from "../../../utils/logger";
import type { AndroidTvRemoteCredentials } from "../credentials";
import { createFrameReader, frameMessage } from "../protocol/framing";
import {
  buildKeyInject,
  buildPingResponse,
  buildRemoteConfiguration,
  buildTextInput,
  parseImeBatchEdit,
  parseMessage,
} from "../protocol/messages";
import { REMOTE_PORT, RemoteDirection, RemoteMessageType } from "../protocol/schema";

export type ConnectionEvent = "connect" | "close" | "error" | "message";

export interface AndroidTvRemoteConnection {
  connect(): Promise<void>;
  disconnect(): void;
  sendKey(keyCode: number, direction?: RemoteDirection): Promise<void>;
  sendText(text: string): Promise<void>;
  on(event: ConnectionEvent, callback: (...args: unknown[]) => void): () => void;
  isConnected(): boolean;
}

interface ConnectionConfig {
  ip: string;
  credentials: AndroidTvRemoteCredentials;
  timeout?: number;
  reconnect?: number;
}

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RECONNECT_MS = 5000;
const MAX_RECONNECT_DELAY_MS = 60000;
const MAX_RECONNECT_ATTEMPTS = 10;
const PING_INTERVAL_MS = 5000;

export function createAndroidTvRemoteConnection(
  config: ConnectionConfig,
): AndroidTvRemoteConnection {
  const { ip, credentials, timeout = DEFAULT_TIMEOUT_MS } = config;
  const baseReconnectDelay = config.reconnect ?? DEFAULT_RECONNECT_MS;

  let socket: tls.TLSSocket | null = null;
  let connected = false;
  let configReceived = false;
  let disposed = false;
  let reconnectAttempts = 0;
  let reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let pingInterval: ReturnType<typeof setInterval> | null = null;

  let imeCounter = 0;
  let imeFieldCounter = 0;

  const frameReader = createFrameReader();

  const listeners: Map<ConnectionEvent, Set<(...args: unknown[]) => void>> = new Map([
    ["connect", new Set()],
    ["close", new Set()],
    ["error", new Set()],
    ["message", new Set()],
  ]);

  function emit(event: ConnectionEvent, ...args: unknown[]) {
    const callbacks = listeners.get(event);
    if (callbacks) {
      for (const cb of callbacks) {
        cb(...args);
      }
    }
  }

  function handleMessage(data: Uint8Array) {
    const message = parseMessage(data);
    if (!message) {
      logger.warn("AndroidTVRemote", "Failed to parse remote message");
      return;
    }

    logger.debug(
      "AndroidTVRemote",
      `Remote message: type=${message.type}, status=${message.status}`,
    );

    // TV sends remoteConfigure first - respond with ours
    if (message.type === RemoteMessageType.REMOTE_CONFIGURE && !configReceived) {
      logger.info("AndroidTVRemote", "Received remoteConfigure from TV, sending our config");
      configReceived = true;
      const configMsg = buildRemoteConfiguration("Couch Remote", "Couch", "com.couch.remote");
      sendRaw(configMsg);
      startPingInterval();
      emit("connect");
      return;
    }

    if (message.type === RemoteMessageType.PING_REQUEST) {
      sendRaw(buildPingResponse());
    }

    if (message.type === RemoteMessageType.IME_BATCH_EDIT) {
      const imeInfo = parseImeBatchEdit(message.payload);
      if (imeInfo) {
        imeCounter = imeInfo.imeCounter;
        imeFieldCounter = imeInfo.fieldCounter;
        logger.debug(
          "AndroidTVRemote",
          `IME state updated: imeCounter=${imeCounter}, fieldCounter=${imeFieldCounter}`,
        );
      }
    }

    emit("message", message);
  }

  function sendRaw(data: Uint8Array): boolean {
    if (socket?.writable) {
      socket.write(frameMessage(data));
      return true;
    }
    return false;
  }

  function startPingInterval() {
    stopPingInterval();
    pingInterval = setInterval(() => {
      if (connected) {
        sendRaw(buildPingResponse());
      }
    }, PING_INTERVAL_MS);
  }

  function stopPingInterval() {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
  }

  function connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (connected) {
        resolve();
        return;
      }

      logger.info("AndroidTVRemote", `Connecting to ${ip}:${REMOTE_PORT}`);

      const timeoutId = setTimeout(() => {
        socket?.destroy();
        reject(new Error("Connection timeout"));
      }, timeout);

      socket = tls.connect(
        {
          host: ip,
          port: REMOTE_PORT,
          cert: credentials.certificate,
          key: credentials.privateKey,
          rejectUnauthorized: false,
          checkServerIdentity: () => undefined,
        },
        () => {
          clearTimeout(timeoutId);
          connected = true;
          reconnectAttempts = 0;
          logger.info("AndroidTVRemote", "TLS connection established, waiting for TV config...");
          resolve();
        },
      );

      socket.on("data", (data: Buffer) => {
        logger.debug("AndroidTVRemote", `Received ${data.length} bytes from TV`);
        frameReader.append(new Uint8Array(data));
        for (let message = frameReader.read(); message; message = frameReader.read()) {
          handleMessage(message);
        }
      });

      socket.on("error", (error) => {
        clearTimeout(timeoutId);
        logger.error("AndroidTVRemote", `Connection error: ${error.message}`);
        emit("error", error);
        if (!connected) {
          reject(error);
        }
      });

      socket.on("end", () => {
        logger.debug("AndroidTVRemote", "Socket end event - TV closed connection");
      });

      socket.on("close", (hadError) => {
        const wasConnected = connected && configReceived;
        connected = false;
        configReceived = false;
        imeCounter = 0;
        imeFieldCounter = 0;
        stopPingInterval();
        frameReader.clear();
        emit("close");
        logger.info("AndroidTVRemote", `Connection closed (hadError=${hadError})`);

        if (
          wasConnected &&
          !disposed &&
          baseReconnectDelay > 0 &&
          reconnectAttempts < MAX_RECONNECT_ATTEMPTS
        ) {
          const delay = Math.min(
            baseReconnectDelay * Math.pow(2, reconnectAttempts),
            MAX_RECONNECT_DELAY_MS,
          );
          reconnectAttempts++;
          logger.info(
            "AndroidTVRemote",
            `Scheduling reconnect ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`,
          );

          reconnectTimeoutId = setTimeout(() => {
            reconnectTimeoutId = null;
            if (!disposed && !connected) {
              connect().catch((err) => {
                logger.error("AndroidTVRemote", `Reconnect failed: ${err.message}`);
              });
            }
          }, delay);
        } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          logger.warn("AndroidTVRemote", "Max reconnect attempts reached, giving up");
        }
      });
    });
  }

  function disconnect() {
    disposed = true;
    stopPingInterval();

    // Clear any pending reconnection timer
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId);
      reconnectTimeoutId = null;
    }

    socket?.destroy();
    socket = null;
    connected = false;
    configReceived = false;
    reconnectAttempts = 0;
    imeCounter = 0;
    imeFieldCounter = 0;
    frameReader.clear();
  }

  async function sendKey(
    keyCode: number,
    direction: RemoteDirection = RemoteDirection.SHORT,
  ): Promise<void> {
    if (!connected) {
      throw new Error("Not connected");
    }
    const message = buildKeyInject(keyCode, direction);
    if (!sendRaw(message)) {
      throw new Error("Failed to send key");
    }
  }

  const KEYCODE_ENTER = 66;
  const KEYCODE_DEL = 67;

  async function sendText(text: string): Promise<void> {
    if (!connected) {
      throw new Error("Not connected");
    }

    if (text === "\n") {
      logger.debug("AndroidTVRemote", "Sending ENTER key");
      const message = buildKeyInject(KEYCODE_ENTER, RemoteDirection.SHORT);
      if (!sendRaw(message)) {
        throw new Error("Failed to send enter key");
      }
      return;
    }

    if (text === "\b") {
      logger.debug("AndroidTVRemote", "Sending DEL (backspace) key");
      const message = buildKeyInject(KEYCODE_DEL, RemoteDirection.SHORT);
      if (!sendRaw(message)) {
        throw new Error("Failed to send backspace key");
      }
      return;
    }

    logger.debug(
      "AndroidTVRemote",
      `Sending text with IME counters: imeCounter=${imeCounter}, fieldCounter=${imeFieldCounter}`,
    );
    const message = buildTextInput(text, imeCounter, imeFieldCounter);
    if (!sendRaw(message)) {
      throw new Error("Failed to send text");
    }
  }

  function on(event: ConnectionEvent, callback: (...args: unknown[]) => void): () => void {
    listeners.get(event)?.add(callback);
    return () => {
      listeners.get(event)?.delete(callback);
    };
  }

  return {
    connect,
    disconnect,
    sendKey,
    sendText,
    on,
    isConnected: () => connected && configReceived,
  };
}
