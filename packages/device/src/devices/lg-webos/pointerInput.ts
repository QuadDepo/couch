import { logger } from "../../utils/logger";
import type { RemoteInputSocket, WebOSRequestOptions } from "./connectionTypes";
import { WEBSOCKET_PORT, WEBSOCKET_SSL_PORT } from "./protocol";

interface PointerInputOptions extends WebOSRequestOptions {
  ip: string;
  socketPath: string;
  timeout: number;
  useSsl: boolean;
  onClose: () => void;
}

export function openPointerInput(options: PointerInputOptions): Promise<RemoteInputSocket> {
  const socketUrl =
    options.socketPath.startsWith("ws://") || options.socketPath.startsWith("wss://")
      ? options.socketPath
      : `${options.useSsl ? "wss" : "ws"}://${options.ip}:${options.useSsl ? WEBSOCKET_SSL_PORT : WEBSOCKET_PORT}${options.socketPath}`;
  const webSocket = new WebSocket(socketUrl, { tls: { rejectUnauthorized: false } });

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(
      () => fail(new Error("Input socket timeout")),
      options.timeoutMs ?? options.timeout,
    );
    const cleanup = () => {
      clearTimeout(timeoutId);
      options.signal?.removeEventListener("abort", abort);
      webSocket.removeEventListener("open", onOpen);
      webSocket.removeEventListener("error", onError);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        webSocket.close();
      } catch {
        // The socket may have failed before it became closable.
      }
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const abort = () =>
      fail(
        options.signal?.reason instanceof Error
          ? options.signal.reason
          : new Error("Operation cancelled"),
      );
    const onError = (error: unknown) => {
      logger.error("WebOS", `Input socket error: ${error}`);
      fail(error);
    };
    const onOpen = () => {
      if (settled) return;
      settled = true;
      cleanup();
      logger.info("WebOS", "Input socket connected");
      resolve({
        send(type: string, payload: object = {}) {
          if (webSocket.readyState !== WebSocket.OPEN)
            throw new Error("Input socket is not connected");
          const fields = Object.entries(payload).map(([key, value]) => `${key}:${value}`);
          webSocket.send(`${fields.join("\n")}\ntype:${type}\n\n`);
        },
        close() {
          webSocket.close();
          options.onClose();
        },
      });
    };
    webSocket.addEventListener("open", onOpen);
    webSocket.addEventListener("error", onError);
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
  });
}
