import type { DeviceDriver, DeviceOperation, DriverReceipt } from "../../runtime/types";
import type { RemoteKey } from "../../types";
import type { RemoteInputSocket, WebOSConnection, WebOSRequestOptions } from "./connection";
import { createWebOSConnection } from "./connection";
import type { WebOSCredentials } from "./credentials";
import { getInputSocketCommand, isInputSocketKey, keymap } from "./keymap";
import {
  URI_DELETE_CHARACTERS,
  URI_GET_AUDIO_STATUS,
  URI_INSERT_TEXT,
  URI_SEND_ENTER_KEY,
  URI_SET_MUTE,
} from "./protocol";

export interface LgWebosDriverConfig {
  ip: string;
  credentials: WebOSCredentials;
  useSsl?: boolean;
}

export interface LgWebosDriverDependencies {
  connection?: WebOSConnection;
  onMuteStateChanged?: (mute: boolean) => void;
}

const OSK_CLOSE_DELAY_MS = 100;

function unsupported(kind: string): Error {
  return new Error(`Unsupported LG webOS operation: ${kind}`);
}

function optionsFor(signal?: AbortSignal, timeoutMs?: number): WebOSRequestOptions {
  return { signal, timeoutMs };
}

function waitForInputSocket(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(
      signal.reason instanceof Error ? signal.reason : new Error("Operation cancelled"),
    );
  }
  return new Promise((resolve, reject) => {
    const complete = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timeout = setTimeout(complete, OSK_CLOSE_DELAY_MS);
    const abort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("Operation cancelled"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export function createLgWebosDriver(
  config: LgWebosDriverConfig,
  dependencies: LgWebosDriverDependencies = {},
): DeviceDriver {
  const connection =
    dependencies.connection ??
    createWebOSConnection({
      ip: config.ip,
      mac: config.credentials.mac ?? "",
      clientKey: config.credentials.clientKey,
      timeout: 15000,
      reconnect: 0,
      useSsl: config.useSsl ?? config.credentials.useSsl,
    });

  let ready = false;
  let openAttempted = false;
  let generation = 0;
  let inputSocket: RemoteInputSocket | null = null;
  let muteState: boolean | undefined;
  let muteSubscriptionStarted = false;
  let closePromise: Promise<void> | undefined;
  let muteTransition = Promise.resolve();

  const enqueueMuteTransition = <T>(transition: () => Promise<T>): Promise<T> => {
    const queuedTransition = muteTransition.then(transition, transition);
    muteTransition = queuedTransition.then(
      () => undefined,
      () => undefined,
    );
    return queuedTransition;
  };

  const updateMuteState = (data: unknown) => {
    if (!data || typeof data !== "object") return;
    const mute = (data as { mute?: unknown }).mute;
    if (typeof mute !== "boolean") return;
    muteState = mute;
    dependencies.onMuteStateChanged?.(mute);
  };

  const subscribeToMute = async () => {
    if (muteSubscriptionStarted) return;
    muteSubscriptionStarted = true;
    try {
      await connection.subscribe(URI_GET_AUDIO_STATUS, {}, updateMuteState);
    } catch {
      muteSubscriptionStarted = false;
    }
  };

  connection.on("close", () => {
    ready = false;
    inputSocket = null;
    muteSubscriptionStarted = false;
    muteState = undefined;
  });
  connection.on("error", () => {
    ready = false;
  });

  const ensureInputSocket = async (options?: WebOSRequestOptions): Promise<RemoteInputSocket> => {
    if (inputSocket) return inputSocket;
    inputSocket = await connection.getInputSocket(options);
    return inputSocket;
  };

  return {
    adapterId: "lg-ssap",
    async open(options = {}) {
      if (ready) return;
      closePromise = undefined;
      openAttempted = true;
      const attempt = ++generation;
      try {
        await connection.connect(options);
        if (attempt !== generation) {
          connection.disconnect();
          return;
        }
        ready = true;
        await subscribeToMute();
      } catch (error) {
        connection.disconnect();
        openAttempted = false;
        throw error;
      }
    },
    async execute(
      operation: DeviceOperation,
      options: { signal?: AbortSignal; timeoutMs?: number } = {},
    ): Promise<DriverReceipt> {
      if (!ready || !connection.isConnected()) throw new Error("LG webOS driver is not open");
      const commandOptions = optionsFor(options.signal, options.timeoutMs);

      switch (operation.kind) {
        case "control.press": {
          const keyCode = keymap[operation.key as RemoteKey];
          if (!keyCode) throw new Error(`Unsupported LG webOS key: ${operation.key}`);
          if (isInputSocketKey(String(keyCode))) {
            const socket = await ensureInputSocket(commandOptions);
            socket.send("button", { name: getInputSocketCommand(keyCode) });
            return { confirmation: "transport-write" };
          }
          const uri = String(keyCode);
          if (uri === URI_SET_MUTE) {
            return enqueueMuteTransition(async () => {
              if (muteState === undefined) {
                const status = await connection.request<{ mute?: unknown }>(
                  URI_GET_AUDIO_STATUS,
                  {},
                  commandOptions,
                );
                updateMuteState(status);
              }
              const nextMute = !(muteState ?? false);
              await connection.request(uri, { mute: nextMute }, commandOptions);
              updateMuteState({ mute: nextMute });
              return { confirmation: "protocol-response" };
            });
          }
          await connection.request(uri, {}, commandOptions);
          return { confirmation: "protocol-response" };
        }
        case "control.text": {
          if (operation.text === "\n") {
            await connection.request(URI_SEND_ENTER_KEY, {}, commandOptions);
            await waitForInputSocket(options.signal);
            const socket = await ensureInputSocket(commandOptions);
            socket.send("button", { name: "ENTER" });
            return { confirmation: "transport-write" };
          } else if (operation.text === "\b") {
            await connection.request(URI_DELETE_CHARACTERS, { count: 1 }, commandOptions);
          } else {
            await connection.request(
              URI_INSERT_TEXT,
              { text: operation.text, replace: 0 },
              commandOptions,
            );
          }
          return { confirmation: "protocol-response" };
        }
        default:
          throw unsupported(operation.kind);
      }
    },
    isReady() {
      return ready && connection.isConnected();
    },
    async close() {
      if (closePromise) return closePromise;
      if (!ready && !openAttempted && !connection.isConnected()) return;
      generation += 1;
      ready = false;
      openAttempted = false;
      inputSocket = null;
      muteSubscriptionStarted = false;
      muteState = undefined;
      closePromise = Promise.resolve(connection.disconnect()).catch((error) => {
        closePromise = undefined;
        throw error;
      });
      return closePromise;
    },
  };
}
