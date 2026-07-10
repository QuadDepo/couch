import { logger } from "../../utils/logger";
import {
  buildDeviceInfoUrl,
  buildKeyCommand,
  buildTextCommand,
  buildTextEndCommand,
  buildWsUrl,
} from "./protocol";

const DEFAULT_TIMEOUT_MS = 15000;
const LOG_TRUNCATE_LENGTH = 200;

export type ConnectionEvent = "connect" | "close" | "error" | "prompt" | "message";

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
  on(event: ConnectionEvent, callback: (...args: any[]) => void): void;
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

  async function fetchMac(): Promise<string | undefined> {
    try {
      const response = await fetch(buildDeviceInfoUrl(ip), {
        signal: AbortSignal.timeout(5000),
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
      let resolved = false;
      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error("Connection timeout"));
          if (ws) {
            ws.close();
            ws = null;
          }
        }
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
          handleMessage(String(event.data), () => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeoutId);
              resolve();
            }
          });
        });

        ws.addEventListener("close", (event) => {
          logger.info("Tizen", `WebSocket closed: code=${event.code}`);
          connected = false;
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutId);
            reject(new Error(`Connection closed: code=${event.code}`));
          }
          emit("close", event);
        });

        ws.addEventListener("error", (error) => {
          logger.error("Tizen", `WebSocket error: ${error}`);
          emit("error", error);
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutId);
            reject(error);
          }
        });
      } catch (error) {
        clearTimeout(timeoutId);
        reject(error);
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
    emit("message", message);

    if (message.event === "ms.channel.connect") {
      const token = message.data?.token;
      if (token) {
        sessionToken = token;
        logger.info("Tizen", "Received token from TV");
      }
      emit("connect");
      onConnected();

      fetchMac().then((mac) => {
        if (mac) {
          logger.info("Tizen", `Discovered MAC: ${mac}`);
        }
      });
    }
  }

  async function sendKey(key: string): Promise<void> {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected");
    }
    ws.send(buildKeyCommand(key));
    logger.debug("Tizen", `Sent key: ${key}`);
  }

  async function sendText(text: string): Promise<void> {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected");
    }
    ws.send(buildTextCommand(text));
    logger.debug("Tizen", `Sent text: ${text}`);
  }

  async function sendInputEnd(): Promise<void> {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected");
    }
    ws.send(buildTextEndCommand());
    logger.debug("Tizen", "Sent InputEnd (confirm)");
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
    // biome-ignore lint/suspicious/noExplicitAny: Event callbacks have varying argument types per event
    on(event: ConnectionEvent, callback: (...args: any[]) => void) {
      listeners.get(event)?.add(callback);
    },
    isConnected: () => connected,
    getToken: () => sessionToken,
  };
}
