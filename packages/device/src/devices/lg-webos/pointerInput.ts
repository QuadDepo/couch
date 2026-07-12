import { logger } from "../../utils/logger";
import { cancellationError } from "./cancellation";
import type { RemoteInputSocket, WebOSRequestOptions } from "./connectionTypes";
import { WEBSOCKET_PORT, WEBSOCKET_SSL_PORT } from "./protocol";
import {
  normalizeWebSocketClose,
  normalizeWebSocketError,
  safeWebSocketEndpoint,
  WebOSTransportError,
} from "./webSocketErrors";

interface PointerInputOptions extends WebOSRequestOptions {
  ip: string;
  socketPath: string;
  timeout: number;
  useSsl: boolean;
  onClose: () => void;
}

// The TV may hand back either an absolute ws(s):// URL or a bare path to append
// to the same host/port used for the main socket.
function buildSocketUrl(ip: string, socketPath: string, useSsl: boolean): string {
  if (useSsl && socketPath.startsWith("ws://")) {
    throw new Error("LG webOS pointer socket must use WSS for an SSL connection");
  }
  if (socketPath.startsWith("ws://") || socketPath.startsWith("wss://")) return socketPath;
  const scheme = useSsl ? "wss" : "ws";
  const port = useSsl ? WEBSOCKET_SSL_PORT : WEBSOCKET_PORT;
  return `${scheme}://${ip}:${port}${socketPath}`;
}

export function openPointerInput(options: PointerInputOptions): Promise<RemoteInputSocket> {
  const socketUrl = buildSocketUrl(options.ip, options.socketPath, options.useSsl);
  const webSocket = new WebSocket(socketUrl, { tls: { rejectUnauthorized: false } });

  return new Promise((resolve, reject) => {
    let settled = false;
    let invalidated = false;
    let socketError: WebOSTransportError | undefined;
    const readyState = () => {
      try {
        return typeof webSocket.readyState === "number" ? webSocket.readyState : -1;
      } catch {
        return -1;
      }
    };
    const timeoutId = setTimeout(
      () =>
        fail(
          socketError ??
            new WebOSTransportError(
              "WEBOS_POINTER_OPEN_TIMEOUT",
              `Input socket open timeout (endpoint=${safeWebSocketEndpoint(socketUrl)}, readyState=${readyState()})`,
            ),
        ),
      options.timeoutMs ?? options.timeout,
    );
    const cleanup = (removeSocketListeners = true) => {
      clearTimeout(timeoutId);
      options.signal?.removeEventListener("abort", abort);
      webSocket.removeEventListener("open", onOpen);
      if (removeSocketListeners) {
        webSocket.removeEventListener("error", onError);
        webSocket.removeEventListener("close", onClose);
      }
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
    const invalidate = () => {
      if (invalidated) return;
      invalidated = true;
      cleanup();
      options.onClose();
    };
    const abort = () => fail(cancellationError(options.signal));
    const onError = (error: unknown) => {
      const normalized = normalizeWebSocketError(
        "WEBOS_POINTER_SOCKET_ERROR",
        "Input socket error",
        error,
        socketUrl,
        readyState(),
      );
      logger.error("WebOS", normalized.message);
      if (!settled) {
        socketError ??= normalized;
        return;
      }
      invalidate();
      try {
        webSocket.close();
      } catch {
        // The socket is already invalidated.
      }
    };
    const onClose = (event: CloseEvent) => {
      const normalized = normalizeWebSocketClose(
        "WEBOS_POINTER_SOCKET_CLOSED",
        "Input socket closed",
        event,
        socketUrl,
        readyState(),
      );
      logger.error("WebOS", normalized.message);
      if (settled) invalidate();
      else fail(normalized);
    };
    const onOpen = () => {
      if (settled) return;
      settled = true;
      cleanup(false);
      logger.info("WebOS", "Input socket connected");
      resolve({
        send(type: string, payload: object = {}) {
          if (readyState() !== WebSocket.OPEN) {
            invalidate();
            throw new Error("Input socket is not connected");
          }
          const fields = Object.entries(payload).map(([key, value]) => `${key}:${value}`);
          try {
            webSocket.send(`${fields.join("\n")}\ntype:${type}\n\n`);
          } catch (error) {
            invalidate();
            throw normalizeWebSocketError(
              "WEBOS_POINTER_SOCKET_ERROR",
              "Input socket write failed",
              error,
              socketUrl,
              readyState(),
            );
          }
        },
        close() {
          if (invalidated) return;
          invalidated = true;
          cleanup();
          try {
            webSocket.close();
          } finally {
            options.onClose();
          }
        },
      });
    };
    webSocket.addEventListener("open", onOpen);
    webSocket.addEventListener("error", onError);
    webSocket.addEventListener("close", onClose);
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
  });
}
