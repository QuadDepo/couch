import { logger } from "../../utils/logger";
import { createConnectionEvents } from "../shared/connectionEvents";
import {
  buildDeviceInfoUrl,
  buildKeyCommand,
  buildTextCommand,
  buildTextEndCommand,
  buildWsUrl,
} from "./protocol";

const DEFAULT_TIMEOUT_MS = 15000;
const MAC_DISCOVERY_TIMEOUT_MS = 5000;
const LOG_TRUNCATE_LENGTH = 200;

export type ConnectionEvent = "connect" | "close" | "error" | "message";

interface ConnectionConfig {
  ip: string;
  token?: string;
  timeout?: number;
}

export interface TizenConnection {
  connect(): Promise<void>;
  disconnect(): void;
  sendKey(key: string): Promise<void>;
  sendText(text: string): Promise<void>;
  sendInputEnd(): Promise<void>;
  // biome-ignore lint/suspicious/noExplicitAny: Event callbacks have varying argument types per event
  on(event: ConnectionEvent, callback: (...args: any[]) => void): () => void;
  isConnected(): boolean;
  getToken(): string | undefined;
}

interface TizenDeviceInfo {
  device?: {
    wifiMac?: string;
    networkType?: string;
    name?: string;
  };
}

export function createTizenConnection(config: ConnectionConfig): TizenConnection {
  const { ip, timeout = DEFAULT_TIMEOUT_MS } = config;

  let ws: WebSocket | null = null;
  let connected = false;
  let sessionToken = config.token;

  const events = createConnectionEvents<ConnectionEvent>(["connect", "close", "error", "message"]);

  async function fetchMac(): Promise<string | undefined> {
    try {
      const response = await fetch(buildDeviceInfoUrl(ip), {
        signal: AbortSignal.timeout(MAC_DISCOVERY_TIMEOUT_MS),
      });
      const data = (await response.json()) as TizenDeviceInfo;
      return data.device?.wifiMac;
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        logger.debug("Tizen", "MAC discovery timed out (TV may be slow to respond)");
      } else {
        logger.debug("Tizen", `MAC discovery failed: ${err}`);
      }
      return undefined;
    }
  }

  async function connect(): Promise<void> {
    if (connected) {
      logger.debug("Tizen", "Already connected");
      return;
    }

    const url = buildWsUrl(ip, sessionToken);
    logger.info(
      "Tizen",
      `Connecting to ${ip} (timeout: ${timeout}ms, hasToken: ${!!sessionToken})`,
    );

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        if (error) reject(error instanceof Error ? error : new Error(String(error)));
        else resolve();
      };

      const timeoutId = setTimeout(() => {
        if (settled) return;
        finish(new Error("Connection timeout"));
        ws?.close();
        ws = null;
      }, timeout);

      try {
        ws = new WebSocket(url, {
          tls: {
            rejectUnauthorized: false,
          },
        });

        ws.addEventListener("open", () => {
          logger.info("Tizen", "WebSocket connection opened");
          connected = true;
        });

        ws.addEventListener("message", (event) => {
          handleMessage(String(event.data), () => finish());
        });

        ws.addEventListener("close", (event) => {
          logger.info("Tizen", `WebSocket closed: code=${event.code}`);
          connected = false;
          finish(new Error(`Connection closed: code=${event.code}`));
          events.emit("close", event);
        });

        ws.addEventListener("error", (error) => {
          logger.error("Tizen", `WebSocket error: ${error}`);
          events.emit("error", error);
          finish(error);
        });
      } catch (error) {
        finish(error);
      }
    });
  }

  function handleMessage(data: string, onConnected: () => void): void {
    let message: { event?: string; data?: { token?: string; clients?: unknown[] } };
    try {
      message = JSON.parse(data);
    } catch {
      const truncated =
        data.length > LOG_TRUNCATE_LENGTH ? `${data.substring(0, LOG_TRUNCATE_LENGTH)}...` : data;
      logger.error("Tizen", `JSON parse error: ${truncated}`);
      return;
    }

    logger.debug("Tizen", `Received event: ${message.event}`);
    events.emit("message", message);

    if (message.event === "ms.channel.connect") {
      const token = message.data?.token;
      if (token) {
        sessionToken = token;
        logger.info("Tizen", "Received token from TV");
      }
      events.emit("connect");
      onConnected();

      void fetchMac().then((mac) => {
        if (mac) {
          logger.info("Tizen", `Discovered MAC: ${mac}`);
        }
      });
    }
  }

  function send(command: string, logMessage: string): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected");
    }
    ws.send(command);
    logger.debug("Tizen", logMessage);
  }

  async function sendKey(key: string): Promise<void> {
    send(buildKeyCommand(key), `Sent key: ${key}`);
  }

  async function sendText(text: string): Promise<void> {
    send(buildTextCommand(text), `Sent text: ${text}`);
  }

  async function sendInputEnd(): Promise<void> {
    send(buildTextEndCommand(), "Sent InputEnd (confirm)");
  }

  function disconnect(): void {
    if (ws) {
      ws.close();
      ws = null;
    }
    connected = false;
  }

  return {
    connect,
    disconnect,
    sendKey,
    sendText,
    sendInputEnd,
    on: events.on,
    isConnected: () => connected,
    getToken: () => sessionToken,
  };
}
