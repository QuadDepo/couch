import * as tls from "node:tls";
import { logger } from "../../../utils/logger";
import { cappedExponentialBackoff } from "../../constants";
import { createConnectionEvents } from "../../shared/connectionEvents";
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

  // Resolves the in-flight connect() promise once REMOTE_CONFIGURE completes.
  // Protocol readiness (not the bare TLS handshake) is what callers await.
  let onProtocolConfigured: (() => void) | null = null;

  const frameReader = createFrameReader();

  const events = createConnectionEvents<ConnectionEvent>(["connect", "close", "error", "message"]);

  function handleMessage(data: Uint8Array) {
    // The remote envelope (RemoteMessage) has no protocol_version/status fields
    // -- field 1 is remote_configure itself -- so bare frames are valid here.
    const message = parseMessage(data, { requireEnvelope: false });
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
      events.emit("connect");
      // Protocol is now ready; release any awaiting connect() call.
      onProtocolConfigured?.();
      onProtocolConfigured = null;
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

    events.emit("message", message);
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

  function canReconnect(wasConnected: boolean): boolean {
    return (
      wasConnected &&
      !disposed &&
      baseReconnectDelay > 0 &&
      reconnectAttempts < MAX_RECONNECT_ATTEMPTS
    );
  }

  function scheduleReconnect() {
    const delay = cappedExponentialBackoff({
      attempt: reconnectAttempts,
      baseDelayMs: baseReconnectDelay,
      maxDelayMs: MAX_RECONNECT_DELAY_MS,
    });
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
  }

  function connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (connected && configReceived) {
        resolve();
        return;
      }

      logger.info("AndroidTVRemote", `Connecting to ${ip}:${REMOTE_PORT}`);

      // The timeout covers TLS handshake *and* REMOTE_CONFIGURE, since connect()
      // only settles once the protocol is ready.
      let settled = false;
      const timeoutId = setTimeout(() => {
        socket?.destroy();
        if (!settled) {
          settled = true;
          reject(new Error("Connection timeout"));
        }
      }, timeout);

      const settleReady = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve();
      };
      const settleFailed = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        reject(error);
      };
      onProtocolConfigured = settleReady;

      const conn = tls.connect(
        {
          host: ip,
          port: REMOTE_PORT,
          cert: credentials.certificate,
          key: credentials.privateKey,
          rejectUnauthorized: false,
          checkServerIdentity: () => undefined,
        },
        () => {
          connected = true;
          reconnectAttempts = 0;
          logger.info("AndroidTVRemote", "TLS connection established, waiting for TV config...");
        },
      );
      socket = conn;

      conn.on("data", (data: Buffer) => {
        logger.debug("AndroidTVRemote", `Received ${data.length} bytes from TV`);
        try {
          frameReader.append(new Uint8Array(data));
          for (let message = frameReader.read(); message; message = frameReader.read()) {
            handleMessage(message);
          }
        } catch (error) {
          // Invalid framing desyncs the stream; drop the socket and let the
          // reconnect path recover rather than throwing out of the listener.
          const err = error instanceof Error ? error : new Error(String(error));
          logger.error("AndroidTVRemote", `Framing error, dropping connection: ${err.message}`);
          events.emit("error", err);
          conn.destroy();
        }
      });

      conn.on("error", (error: Error) => {
        logger.error("AndroidTVRemote", `Connection error: ${error.message}`);
        events.emit("error", error);
        settleFailed(error);
      });

      conn.on("end", () => {
        logger.debug("AndroidTVRemote", "Socket end event - TV closed connection");
      });

      conn.on("close", (hadError: boolean) => {
        const wasConnected = connected && configReceived;
        connected = false;
        configReceived = false;
        imeCounter = 0;
        imeFieldCounter = 0;
        stopPingInterval();
        frameReader.clear();
        events.emit("close");
        logger.info("AndroidTVRemote", `Connection closed (hadError=${hadError})`);

        if (canReconnect(wasConnected)) {
          scheduleReconnect();
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

  function sendOrThrow(data: Uint8Array, action: string) {
    if (!sendRaw(data)) {
      throw new Error(`Failed to ${action}`);
    }
  }

  const KEYCODE_ENTER = 66;
  const KEYCODE_DEL = 67;

  async function sendKey(
    keyCode: number,
    direction: RemoteDirection = RemoteDirection.SHORT,
  ): Promise<void> {
    if (!connected) {
      throw new Error("Not connected");
    }
    sendOrThrow(buildKeyInject(keyCode, direction), "send key");
  }

  async function sendText(text: string): Promise<void> {
    if (!connected) {
      throw new Error("Not connected");
    }

    // ENTER and BACKSPACE are key events, not IME text edits.
    if (text === "\n") {
      logger.debug("AndroidTVRemote", "Sending ENTER key");
      return sendKey(KEYCODE_ENTER);
    }
    if (text === "\b") {
      logger.debug("AndroidTVRemote", "Sending DEL (backspace) key");
      return sendKey(KEYCODE_DEL);
    }

    logger.debug(
      "AndroidTVRemote",
      `Sending text with IME counters: imeCounter=${imeCounter}, fieldCounter=${imeFieldCounter}`,
    );
    sendOrThrow(buildTextInput(text, imeCounter, imeFieldCounter), "send text");
  }

  return {
    connect,
    disconnect,
    sendKey,
    sendText,
    on: events.on,
    isConnected: () => connected && configReceived,
  };
}
