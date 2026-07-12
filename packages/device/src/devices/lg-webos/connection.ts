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
import {
  isRetryableTransportError,
  normalizeWebSocketClose,
  normalizeWebSocketError,
  safeWebSocketEndpoint,
  WebOSTransportError,
} from "./webSocketErrors";

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_CONNECT_ATTEMPTS = 3;
const MAX_CONNECT_ATTEMPT_MS = 5000;
const MAX_RETRY_BACKOFF_MS = 500;

function parseSocketPath(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const value = (payload as Record<string, unknown>).socketPath;
    if (typeof value === "string") return value;
  }
  throw new Error("No socket path in response");
}

function remaining(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

function sharedSignal(signal: AbortSignal | undefined, lifecycleSignal: AbortSignal): AbortSignal {
  return signal ? AbortSignal.any([signal, lifecycleSignal]) : lifecycleSignal;
}

function waitForBudget<T>(
  promise: Promise<T>,
  options: WebOSRequestOptions,
  fallbackTimeout: number,
  timeoutError: () => Error,
  onLeave: (abandoned: boolean, error?: Error) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (abandoned: boolean, error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      options.signal?.removeEventListener("abort", abort);
      onLeave(abandoned, error);
      if (error) reject(error);
      else resolve(value as T);
    };
    const abort = () => finish(true, cancellationError(options.signal));
    const timeoutId = setTimeout(
      () => finish(true, timeoutError()),
      options.timeoutMs ?? fallbackTimeout,
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    promise.then(
      (value) => finish(false, undefined, value),
      (error) => finish(false, error instanceof Error ? error : new Error(String(error))),
    );
  });
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(cancellationError(signal));
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(finish, ms);
    function finish() {
      signal.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", abort);
      reject(cancellationError(signal));
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

function closeWebSocket(socket: WebSocket | null): Promise<void> {
  if (!socket || socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      socket.removeEventListener("close", finish);
      socket.removeEventListener("error", finish);
      resolve();
    };
    const timeoutId = setTimeout(finish, 250);
    socket.addEventListener("close", finish, { once: true });
    socket.addEventListener("error", finish, { once: true });
    try {
      socket.close();
    } catch {
      finish();
    }
  });
}

function closePointerInput(socket: RemoteInputSocket | null): Promise<void> {
  return Promise.resolve().then(() => socket?.close());
}

export function createWebOSConnection(config: ConnectionConfig): WebOSConnection {
  const timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;
  const useSsl = config.useSsl ?? false;
  let webSocket: WebSocket | null = null;
  let inputSocket: RemoteInputSocket | null = null;
  let inputSocketPromise: Promise<RemoteInputSocket> | null = null;
  let inputSocketController: AbortController | null = null;
  let inputSocketWaiters = 0;
  let inputStage: "path" | "open" = "path";
  let connectPromise: Promise<void> | null = null;
  let connectController: AbortController | null = null;
  let connectWaiters = 0;
  let connectStage: "open" | "registration" = "open";
  let disconnectPromise: Promise<void> | null = null;
  const transportTeardowns = new Set<Promise<void>>();
  let lifecycleController = new AbortController();
  let connected = false;
  let paired = !!config.clientKey;
  let clientKey = config.clientKey;
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

  const socketUrl = `${useSsl ? "wss" : "ws"}://${config.ip}:${useSsl ? WEBSOCKET_SSL_PORT : WEBSOCKET_PORT}`;

  function trackTeardown(values: Array<Promise<unknown> | null>): void {
    const teardown = Promise.allSettled(values.filter((value) => value !== null)).then(
      () => undefined,
    );
    transportTeardowns.add(teardown);
    void teardown.finally(() => transportTeardowns.delete(teardown));
  }

  function clearMain(socket: WebSocket, error: Error): boolean {
    if (webSocket !== socket) return false;
    webSocket = null;
    connected = false;
    paired = false;
    channel.reset(error);
    inputSocketController?.abort(error);
    const pointerAttempt = inputSocketPromise;
    inputSocketController = null;
    inputSocketPromise = null;
    const pointer = inputSocket;
    inputSocket = null;
    trackTeardown([closeWebSocket(socket), closePointerInput(pointer), pointerAttempt]);
    return true;
  }

  function invalidateMain(socket: WebSocket, error: Error, event: "error" | "close"): void {
    if (!clearMain(socket, error)) return;
    events.emit(event, error);
  }

  function connectAttempt(signal: AbortSignal, attemptTimeout: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let socket: WebSocket | null = null;
      let settled = false;
      let established = false;
      let socketError: WebOSTransportError | undefined;
      const attemptDeadline = Date.now() + attemptTimeout;

      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(openTimeout);
        signal.removeEventListener("abort", abort);
        if (!error) {
          established = true;
          connected = true;
          resolve();
          events.emit("connect");
          return;
        }
        const failure = error instanceof Error ? error : new Error(String(error));
        if (socket && !clearMain(socket, failure)) trackTeardown([closeWebSocket(socket)]);
        reject(failure);
      };
      const abort = () => finish(cancellationError(signal));
      const openTimeout = setTimeout(
        () =>
          finish(
            socketError ??
              new WebOSTransportError(
                "WEBOS_MAIN_OPEN_TIMEOUT",
                `LG webOS main WebSocket open timeout (endpoint=${safeWebSocketEndpoint(socketUrl)}, readyState=${socket?.readyState ?? WebSocket.CLOSED})`,
              ),
          ),
        attemptTimeout,
      );

      try {
        const candidate = new WebSocket(socketUrl, { tls: { rejectUnauthorized: false } });
        socket = candidate;
        webSocket = candidate;
        candidate.addEventListener("open", async () => {
          if (webSocket !== candidate || settled) return;
          clearTimeout(openTimeout);
          connectStage = "registration";
          try {
            await channel.register({ signal, timeoutMs: remaining(attemptDeadline) });
            finish();
          } catch (error) {
            finish(
              error instanceof Error && error.message === "Registration timeout"
                ? (socketError ??
                    new WebOSTransportError(
                      "WEBOS_REGISTRATION_TIMEOUT",
                      `LG webOS registration timeout (endpoint=${safeWebSocketEndpoint(socketUrl)}, readyState=${candidate.readyState})`,
                    ))
                : error,
            );
          }
        });
        candidate.addEventListener("message", (event) => {
          if (webSocket === candidate) channel.handleMessage(event.data);
        });
        candidate.addEventListener("error", (event) => {
          if (webSocket !== candidate) return;
          const error = normalizeWebSocketError(
            "WEBOS_MAIN_SOCKET_ERROR",
            "LG webOS main WebSocket error",
            event,
            socketUrl,
            candidate.readyState,
          );
          if (established) invalidateMain(candidate, error, "error");
          else socketError ??= error;
        });
        candidate.addEventListener("close", (event) => {
          if (webSocket !== candidate) return;
          const error = normalizeWebSocketClose(
            "WEBOS_MAIN_SOCKET_CLOSED",
            "LG webOS main WebSocket closed",
            event,
            socketUrl,
            candidate.readyState,
          );
          if (!established) finish(error);
          else invalidateMain(candidate, error, "close");
        });
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      } catch (error) {
        finish(
          normalizeWebSocketError(
            "WEBOS_MAIN_SOCKET_ERROR",
            "LG webOS main WebSocket error",
            error,
            socketUrl,
            WebSocket.CLOSED,
          ),
        );
      }
    });
  }

  async function establish(producerSignal: AbortSignal): Promise<void> {
    const signal = sharedSignal(producerSignal, lifecycleController.signal);
    const maxAttempts = clientKey ? MAX_CONNECT_ATTEMPTS : 1;
    let lastError: unknown;
    events.emit("message", `Connecting to ${config.ip}...`);

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (signal.aborted) throw cancellationError(signal);
      connectStage = "open";
      events.emit("message", `Connection attempt ${attempt + 1}/${maxAttempts}`);
      try {
        await connectAttempt(signal, MAX_CONNECT_ATTEMPT_MS);
        return;
      } catch (error) {
        lastError = error;
        if (signal.aborted) throw cancellationError(signal);
        if (!isRetryableTransportError(error) || attempt + 1 >= maxAttempts) throw error;
        const backoff = Math.min(MAX_RETRY_BACKOFF_MS, 250 * (attempt + 1));
        if (backoff > 0) await delay(backoff, signal);
      }
    }
    throw (
      lastError ??
      new WebOSTransportError(
        "WEBOS_MAIN_OPEN_TIMEOUT",
        `LG webOS main WebSocket open timeout (endpoint=${safeWebSocketEndpoint(socketUrl)})`,
      )
    );
  }

  function waitForSharedConnect(
    promise: Promise<void>,
    options: WebOSRequestOptions,
  ): Promise<void> {
    connectWaiters += 1;
    return waitForBudget(
      promise,
      options,
      timeout,
      () =>
        new WebOSTransportError(
          connectStage === "registration"
            ? "WEBOS_REGISTRATION_TIMEOUT"
            : "WEBOS_MAIN_OPEN_TIMEOUT",
          `LG webOS ${connectStage} deadline exceeded (endpoint=${safeWebSocketEndpoint(socketUrl)})`,
        ),
      (abandoned, error) => {
        connectWaiters -= 1;
        if (abandoned && connectWaiters === 0) connectController?.abort(error);
      },
    );
  }

  function connect(options: WebOSRequestOptions = {}): Promise<void> {
    if (options.signal?.aborted) return Promise.reject(cancellationError(options.signal));
    if (connected && paired) return Promise.resolve();
    if (disconnectPromise) return disconnectPromise.then(() => connect(options));
    if (!connectPromise) {
      if (lifecycleController.signal.aborted) lifecycleController = new AbortController();
      connectController = new AbortController();
      connectPromise = establish(connectController.signal)
        .catch((error) => {
          events.emit("error", error);
          throw error;
        })
        .finally(() => {
          connectPromise = null;
          connectController = null;
        });
    }
    return waitForSharedConnect(connectPromise, options);
  }

  function disconnect(): Promise<void> {
    if (disconnectPromise) return disconnectPromise;
    lifecycleController.abort(new Error("Connection closed"));
    connectController?.abort(new Error("Connection closed"));
    inputSocketController?.abort(new Error("Connection closed"));
    const main = webSocket;
    const pointer = inputSocket;
    const pointerAttempt = inputSocketPromise;
    webSocket = null;
    inputSocket = null;
    connected = false;
    paired = false;
    channel.reset(new Error("Connection closed"));
    const activeTeardowns = [...transportTeardowns];
    disconnectPromise = Promise.allSettled([
      closeWebSocket(main),
      closePointerInput(pointer),
      pointerAttempt?.catch(() => undefined),
      connectPromise?.catch(() => undefined),
      ...activeTeardowns,
    ]).then(() => undefined);
    disconnectPromise.finally(() => {
      disconnectPromise = null;
    });
    return disconnectPromise;
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

  async function establishInputSocket(producerSignal: AbortSignal): Promise<RemoteInputSocket> {
    const signal = sharedSignal(producerSignal, lifecycleController.signal);
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (signal.aborted) throw cancellationError(signal);
      const attemptTimeout = MAX_CONNECT_ATTEMPT_MS;
      const attemptDeadline = Date.now() + attemptTimeout;
      try {
        inputStage = "path";
        let socketPath: string;
        try {
          socketPath = await channel.request(
            URI_POINTER_INPUT,
            {},
            { signal, timeoutMs: attemptTimeout },
            parseSocketPath,
          );
        } catch (error) {
          throw error instanceof Error && error.message === "Request timeout"
            ? new WebOSTransportError(
                "WEBOS_POINTER_PATH_TIMEOUT",
                "LG webOS pointer socket path request timeout",
              )
            : error;
        }
        let closed = false;
        let candidate: RemoteInputSocket | null = null;
        inputStage = "open";
        candidate = await openPointerInput({
          ip: config.ip,
          socketPath,
          timeout,
          useSsl,
          signal,
          timeoutMs: remaining(attemptDeadline),
          onClose: () => {
            closed = true;
            if (inputSocket === candidate) inputSocket = null;
          },
        });
        if (closed) {
          throw new WebOSTransportError(
            "WEBOS_POINTER_SOCKET_CLOSED",
            "LG webOS pointer WebSocket closed during establishment",
          );
        }
        if (signal.aborted || !connected) {
          try {
            candidate.close();
          } catch {
            // Teardown must preserve the lifecycle cancellation.
          }
          throw cancellationError(signal);
        }
        inputSocket = candidate;
        return candidate;
      } catch (error) {
        lastError = error;
        if (signal.aborted) throw cancellationError(signal);
        if (!isRetryableTransportError(error) || attempt === 1) throw error;
        events.emit("message", "Retrying pointer socket establishment");
      }
    }
    throw (
      lastError ??
      new WebOSTransportError(
        "WEBOS_POINTER_OPEN_TIMEOUT",
        "LG webOS pointer WebSocket open timeout",
      )
    );
  }

  function getInputSocket(options: WebOSRequestOptions = {}): Promise<RemoteInputSocket> {
    if (!connected) return Promise.reject(new Error("Not connected"));
    if (inputSocket) return Promise.resolve(inputSocket);
    if (!inputSocketPromise) {
      inputSocketController = new AbortController();
      const pending = establishInputSocket(inputSocketController.signal);
      const tracked = pending.finally(() => {
        if (inputSocketPromise === tracked) {
          inputSocketPromise = null;
          inputSocketController = null;
        }
      });
      inputSocketPromise = tracked;
    }
    inputSocketWaiters += 1;
    return waitForBudget(
      inputSocketPromise,
      options,
      timeout,
      () =>
        new WebOSTransportError(
          inputStage === "path" ? "WEBOS_POINTER_PATH_TIMEOUT" : "WEBOS_POINTER_OPEN_TIMEOUT",
          `LG webOS pointer ${inputStage} deadline exceeded`,
        ),
      (abandoned, error) => {
        inputSocketWaiters -= 1;
        if (abandoned && inputSocketWaiters === 0) inputSocketController?.abort(error);
      },
    );
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
