import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createWebOSConnection } from "./connection";

type Listener = (event: Record<string, unknown>) => void;

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: MockWebSocket[] = [];
  static onCreate: (socket: MockWebSocket) => void = () => undefined;
  static onSend: (socket: MockWebSocket, data: string) => void = () => undefined;

  readonly listeners = new Map<string, Set<Listener>>();
  readonly sent: string[] = [];
  readyState = MockWebSocket.CONNECTING;
  closeCalls = 0;
  autoClose = true;
  closeError: Error | undefined;

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
    MockWebSocket.onCreate(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: Record<string, unknown> = {}): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open");
  }

  message(value: unknown): void {
    this.emit("message", { data: JSON.stringify(value) });
  }

  error(message: string, cause?: Error): void {
    this.emit("error", { message, error: cause });
  }

  remoteClose(code: number, reason: string): void {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close", { code, reason });
  }

  send(data: string): void {
    this.sent.push(data);
    MockWebSocket.onSend(this, data);
  }

  close(): void {
    this.closeCalls += 1;
    if (this.closeError) throw this.closeError;
    if (this.readyState === MockWebSocket.CLOSED) return;
    if (this.autoClose) this.remoteClose(1000, "");
  }
}

const nativeWebSocket = globalThis.WebSocket;

function connection(timeout = 100) {
  return createWebOSConnection({
    ip: "192.0.2.20",
    clientKey: "client-key",
    timeout,
    useSsl: true,
  });
}

function registerSuccessfully(socket: MockWebSocket, data: string): void {
  const message = JSON.parse(data);
  if (message.type === "register") {
    queueMicrotask(() =>
      socket.message({
        id: message.id,
        type: "registered",
        payload: { "client-key": "client-key" },
      }),
    );
  }
}

beforeEach(() => {
  MockWebSocket.instances.length = 0;
  MockWebSocket.onCreate = () => undefined;
  MockWebSocket.onSend = () => undefined;
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  globalThis.WebSocket = nativeWebSocket;
});

describe("LG webOS connection establishment", () => {
  test("emits connect only after the connection can serve requests", async () => {
    MockWebSocket.onCreate = (socket) => queueMicrotask(() => socket.open());
    MockWebSocket.onSend = (socket, data) => {
      const message = JSON.parse(data);
      if (message.type === "register") registerSuccessfully(socket, data);
      if (message.uri === "ssap://audio/getVolume") {
        socket.message({
          id: message.id,
          type: "response",
          payload: { returnValue: true, volume: 12 },
        });
      }
    };
    const value = connection();
    let liveAtEvent = false;
    let requestAtEvent: Promise<unknown> | undefined;
    value.on("connect", () => {
      liveAtEvent = value.isConnected();
      requestAtEvent = value.request("ssap://audio/getVolume");
    });

    await value.connect();

    expect(liveAtEvent).toBe(true);
    await expect(requestAtEvent).resolves.toEqual({ returnValue: true, volume: 12 });
  });

  test("connect remains successful when pairing-style cleanup starts in its listener", async () => {
    MockWebSocket.onCreate = (socket) => queueMicrotask(() => socket.open());
    MockWebSocket.onSend = registerSuccessfully;
    const value = connection();
    let cleanup: Promise<void> | undefined;
    value.on("connect", () => {
      cleanup = value.disconnect();
    });

    await expect(value.connect()).resolves.toBeUndefined();
    await expect(cleanup).resolves.toBeUndefined();
  });

  test("classifies main open and registration timeouts separately", async () => {
    const openError = await connection(30)
      .connect()
      .catch((error) => error);
    expect(openError).toMatchObject({ code: "WEBOS_MAIN_OPEN_TIMEOUT" });

    MockWebSocket.instances.length = 0;
    MockWebSocket.onCreate = (socket) => queueMicrotask(() => socket.open());
    const registrationError = await connection(30)
      .connect()
      .catch((error) => error);
    expect(registrationError).toMatchObject({ code: "WEBOS_REGISTRATION_TIMEOUT" });
  });

  test("retries a transient failure with a fresh socket", async () => {
    MockWebSocket.onCreate = (socket) => {
      queueMicrotask(() => {
        if (MockWebSocket.instances.length > 1) socket.open();
        else {
          socket.error("transient failure");
          socket.remoteClose(1006, "transport dropped");
        }
      });
    };
    MockWebSocket.onSend = registerSuccessfully;
    const value = connection(400);

    await value.connect();

    expect(value.isConnected()).toBe(true);
    expect(MockWebSocket.instances.length).toBe(2);
    expect(MockWebSocket.instances[0]).not.toBe(MockWebSocket.instances[1]);
  });

  test("does not retry authorization or protocol failures", async () => {
    MockWebSocket.onCreate = (socket) => queueMicrotask(() => socket.open());
    MockWebSocket.onSend = (socket, data) => {
      const message = JSON.parse(data);
      socket.message({
        id: message.id,
        type: "response",
        payload: { returnValue: false, errorCode: 403, errorText: "permission denied" },
      });
    };
    const authorization = await connection()
      .connect()
      .catch((error) => error);
    expect(authorization).toMatchObject({ code: "WEBOS_AUTHORIZATION_REQUIRED" });
    expect(MockWebSocket.instances).toHaveLength(1);

    MockWebSocket.instances.length = 0;
    MockWebSocket.onSend = (socket) => socket.message({ invalid: true });
    const protocol = await connection()
      .connect()
      .catch((error) => error);
    expect(protocol).toMatchObject({ code: "WEBOS_INVALID_RESPONSE" });
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  test("cancellation stops the current attempt without retrying", async () => {
    const controller = new AbortController();
    const pending = connection().connect({ signal: controller.signal });
    controller.abort(new Error("cancelled by caller"));

    await expect(pending).rejects.toThrow("cancelled by caller");
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  test("keeps retries inside the supplied deadline", async () => {
    const started = Date.now();
    const error = await connection()
      .connect({ timeoutMs: 40 })
      .catch((caught) => caught);

    expect(error).toMatchObject({ code: "WEBOS_MAIN_OPEN_TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(120);
  });

  test("coalesces concurrent connect callers", async () => {
    MockWebSocket.onCreate = (socket) => queueMicrotask(() => socket.open());
    MockWebSocket.onSend = registerSuccessfully;
    const value = connection();

    await Promise.all([value.connect(), value.connect()]);

    expect(MockWebSocket.instances).toHaveLength(1);
  });

  test("lets one coalesced caller cancel without cancelling the shared attempt", async () => {
    MockWebSocket.onSend = registerSuccessfully;
    const value = connection();
    const controller = new AbortController();
    const cancelled = value.connect({ signal: controller.signal });
    const connected = value.connect();

    controller.abort(new Error("first caller cancelled"));
    MockWebSocket.instances[0]?.open();

    await expect(cancelled).rejects.toThrow("first caller cancelled");
    await expect(connected).resolves.toBeUndefined();
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  test("gives coalesced connect callers independent timeout budgets", async () => {
    MockWebSocket.onSend = registerSuccessfully;
    const value = connection(100);
    const impatient = value.connect({ timeoutMs: 5 });
    const patient = value.connect({ timeoutMs: 100 });

    await expect(impatient).rejects.toMatchObject({ code: "WEBOS_MAIN_OPEN_TIMEOUT" });
    expect(value.isConnected()).toBe(false);
    MockWebSocket.instances[0]?.open();

    await expect(patient).resolves.toBeUndefined();
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  test("lets a caller extend connection establishment beyond the configured fallback", async () => {
    MockWebSocket.onCreate = (socket) => setTimeout(() => socket.open(), 50);
    MockWebSocket.onSend = registerSuccessfully;

    const value = connection(30);
    await value.connect({ timeoutMs: 100 });

    expect(value.isConnected()).toBe(true);
  });

  test("normalizes close metadata without leaking paths or credentials", async () => {
    MockWebSocket.onCreate = (socket) =>
      queueMicrotask(() =>
        socket.remoteClose(
          1008,
          "rejected wss://192.0.2.20:3001/resources/pointer?token=secret&client-key=raw",
        ),
      );
    const error = await connection()
      .connect()
      .catch((caught) => caught);

    expect(error).toMatchObject({ code: "WEBOS_MAIN_SOCKET_CLOSED" });
    expect(error.message).toContain("code=1008");
    expect(error.message).toContain("endpoint=wss://192.0.2.20:3001");
    expect(JSON.stringify(error)).not.toMatch(/resources|pointer|secret|client-key/);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  test.each([
    1008, 1002,
  ])("does not retry when an error is followed later by non-retryable close %d", async (code) => {
    MockWebSocket.onCreate = (socket) => {
      queueMicrotask(() => socket.error("transport failed"));
      setTimeout(() => socket.remoteClose(code, "policy rejected token=secret"), 40);
    };

    const error = await connection(100)
      .connect({ timeoutMs: 100 })
      .catch((caught) => caught);

    expect(error).toMatchObject({ code: "WEBOS_MAIN_SOCKET_CLOSED", retryable: false });
    expect(error.message).toContain(`code=${code}`);
    expect(error.message).not.toContain("secret");
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  test("emits a normalized close error instead of the raw CloseEvent", async () => {
    MockWebSocket.onCreate = (socket) => queueMicrotask(() => socket.open());
    MockWebSocket.onSend = registerSuccessfully;
    const value = connection();
    let closed: unknown;
    value.on("close", (event) => {
      closed = event;
    });
    await value.connect();

    MockWebSocket.instances[0]?.remoteClose(
      1008,
      "wss://192.0.2.20:3001/private/pointer?token=secret",
    );

    expect(closed).toMatchObject({ code: "WEBOS_MAIN_SOCKET_CLOSED", retryable: false });
    expect(String(closed)).not.toMatch(/private|pointer|secret|token/);
  });
});

describe("LG webOS pointer establishment", () => {
  function connectWithPointerResponses() {
    let pointerRequests = 0;
    MockWebSocket.onCreate = (socket) => {
      queueMicrotask(() => {
        if (socket.url.includes("/pointer/1")) {
          socket.error("first pointer transport failed");
          socket.remoteClose(1006, "transport dropped");
        } else socket.open();
      });
    };
    MockWebSocket.onSend = (socket, data) => {
      const message = JSON.parse(data);
      if (message.type === "register") registerSuccessfully(socket, data);
      if (message.uri === "ssap://com.webos.service.networkinput/getPointerInputSocket") {
        pointerRequests += 1;
        queueMicrotask(() =>
          socket.message({
            id: message.id,
            type: "response",
            payload: {
              returnValue: true,
              socketPath: `wss://192.0.2.20:3001/pointer/${pointerRequests}?token=secret`,
            },
          }),
        );
      }
    };
    return { value: connection(), pointerRequests: () => pointerRequests };
  }

  test("classifies pointer socket-path request timeout", async () => {
    MockWebSocket.onCreate = (socket) => queueMicrotask(() => socket.open());
    MockWebSocket.onSend = registerSuccessfully;
    const value = connection();
    await value.connect();

    const error = await value.getInputSocket({ timeoutMs: 20 }).catch((caught) => caught);

    expect(error).toMatchObject({ code: "WEBOS_POINTER_PATH_TIMEOUT" });
  });

  test.each([
    1008, 1002,
  ])("does not retry when a pointer error is followed later by close %d", async (code) => {
    let pointerRequests = 0;
    MockWebSocket.onCreate = (socket) => {
      if (MockWebSocket.instances.length === 1) queueMicrotask(() => socket.open());
      else {
        queueMicrotask(() => socket.error("pointer transport failed"));
        setTimeout(() => socket.remoteClose(code, "policy rejected token=secret"), 40);
      }
    };
    MockWebSocket.onSend = (socket, data) => {
      const message = JSON.parse(data);
      if (message.type === "register") registerSuccessfully(socket, data);
      if (message.uri === "ssap://com.webos.service.networkinput/getPointerInputSocket") {
        pointerRequests += 1;
        socket.message({
          id: message.id,
          type: "response",
          payload: { returnValue: true, socketPath: "wss://192.0.2.20:3001/pointer" },
        });
      }
    };
    const value = connection();
    await value.connect();

    const error = await value.getInputSocket({ timeoutMs: 100 }).catch((caught) => caught);

    expect(error).toMatchObject({ code: "WEBOS_POINTER_SOCKET_CLOSED", retryable: false });
    expect(pointerRequests).toBe(1);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  test("retries pointer establishment and clears the cache after remote close", async () => {
    const { value, pointerRequests } = connectWithPointerResponses();
    await value.connect();

    const first = await value.getInputSocket({ timeoutMs: 100 });
    expect(pointerRequests()).toBe(2);
    expect(MockWebSocket.instances).toHaveLength(3);

    MockWebSocket.instances[2]?.remoteClose(1006, "remote close");
    const second = await value.getInputSocket({ timeoutMs: 100 });

    expect(second).not.toBe(first);
    expect(pointerRequests()).toBe(3);
    expect(MockWebSocket.instances).toHaveLength(4);
  });

  test("main error without close clears both transports before reconnect", async () => {
    const { value, pointerRequests } = connectWithPointerResponses();
    await value.connect();
    const first = await value.getInputSocket({ timeoutMs: 100 });
    const firstPointer = MockWebSocket.instances[2];

    MockWebSocket.instances[0]?.error("main transport failed");
    expect(value.isConnected()).toBe(false);
    await Bun.sleep(0);
    expect(firstPointer?.closeCalls).toBe(1);

    await value.connect();
    const second = await value.getInputSocket({ timeoutMs: 100 });

    expect(second).not.toBe(first);
    expect(pointerRequests()).toBe(3);
  });

  test("disconnect awaits teardown already started by a main error", async () => {
    MockWebSocket.onCreate = (socket) => queueMicrotask(() => socket.open());
    MockWebSocket.onSend = registerSuccessfully;
    const value = connection();
    await value.connect();
    const main = MockWebSocket.instances[0];
    if (!main) throw new Error("main socket was not created");
    main.autoClose = false;

    main.error("main transport failed");
    let disconnected = false;
    const closing = value.disconnect().then(() => {
      disconnected = true;
    });
    await Bun.sleep(0);

    expect(disconnected).toBe(false);
    main.remoteClose(1000, "");
    await closing;
    expect(disconnected).toBe(true);
  });

  test("pointer close failures cannot escape main teardown", async () => {
    const { value } = connectWithPointerResponses();
    await value.connect();
    await value.getInputSocket({ timeoutMs: 100 });
    const main = MockWebSocket.instances[0];
    const pointer = MockWebSocket.instances[2];
    if (!main || !pointer) throw new Error("sockets were not created");
    pointer.closeError = new Error("pointer close failed");

    expect(() => main.error("main transport failed")).not.toThrow();
    await expect(value.disconnect()).resolves.toBeUndefined();
  });

  test("lets one pointer caller cancel without cancelling another waiter", async () => {
    let pointerSocket: MockWebSocket | undefined;
    MockWebSocket.onCreate = (socket) => {
      if (MockWebSocket.instances.length === 1) queueMicrotask(() => socket.open());
      else pointerSocket = socket;
    };
    MockWebSocket.onSend = (socket, data) => {
      const message = JSON.parse(data);
      if (message.type === "register") registerSuccessfully(socket, data);
      if (message.uri === "ssap://com.webos.service.networkinput/getPointerInputSocket") {
        socket.message({
          id: message.id,
          type: "response",
          payload: { returnValue: true, socketPath: "wss://192.0.2.20:3001/pointer" },
        });
      }
    };
    const value = connection();
    await value.connect();
    const controller = new AbortController();
    const cancelled = value.getInputSocket({ signal: controller.signal });
    const patient = value.getInputSocket({ timeoutMs: 100 });

    while (!pointerSocket) await Bun.sleep(0);
    controller.abort(new Error("pointer caller cancelled"));
    pointerSocket?.open();

    await expect(cancelled).rejects.toThrow("pointer caller cancelled");
    await expect(patient).resolves.toBeDefined();
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  test("lets a caller extend pointer establishment beyond the configured fallback", async () => {
    let pointer: MockWebSocket | undefined;
    MockWebSocket.onCreate = (socket) => {
      if (MockWebSocket.instances.length === 1) queueMicrotask(() => socket.open());
      else {
        pointer = socket;
        setTimeout(() => socket.open(), 50);
      }
    };
    MockWebSocket.onSend = (socket, data) => {
      const message = JSON.parse(data);
      if (message.type === "register") registerSuccessfully(socket, data);
      if (message.uri === "ssap://com.webos.service.networkinput/getPointerInputSocket") {
        socket.message({
          id: message.id,
          type: "response",
          payload: { returnValue: true, socketPath: "wss://192.0.2.20:3001/pointer" },
        });
      }
    };
    const value = connection(30);
    await value.connect();

    const impatient = value.getInputSocket({ timeoutMs: 5 });
    const patient = value.getInputSocket({ timeoutMs: 100 });

    await expect(impatient).rejects.toMatchObject({ code: "WEBOS_POINTER_OPEN_TIMEOUT" });
    await expect(patient).resolves.toBeDefined();
    expect(pointer?.readyState).toBe(MockWebSocket.OPEN);
  });

  test("does not retry pointer establishment after its sole waiter times out", async () => {
    let pointerRequests = 0;
    MockWebSocket.onCreate = (socket) => queueMicrotask(() => socket.open());
    MockWebSocket.onSend = (socket, data) => {
      const message = JSON.parse(data);
      if (message.type === "register") registerSuccessfully(socket, data);
      if (message.uri === "ssap://com.webos.service.networkinput/getPointerInputSocket") {
        pointerRequests += 1;
      }
    };
    const value = connection(100);
    const messages: string[] = [];
    value.on("message", (message) => messages.push(String(message)));
    await value.connect();

    await expect(value.getInputSocket({ timeoutMs: 10 })).rejects.toMatchObject({
      code: "WEBOS_POINTER_PATH_TIMEOUT",
    });
    await Bun.sleep(20);
    expect(pointerRequests).toBe(1);
    expect(messages).not.toContain("Retrying pointer socket establishment");
  });

  test("disconnect closes a pointer that resolves before its publication continuation", async () => {
    let pointerSocket: MockWebSocket | undefined;
    MockWebSocket.onCreate = (socket) => {
      if (MockWebSocket.instances.length === 1) queueMicrotask(() => socket.open());
      else pointerSocket = socket;
    };
    MockWebSocket.onSend = (socket, data) => {
      const message = JSON.parse(data);
      if (message.type === "register") registerSuccessfully(socket, data);
      if (message.uri === "ssap://com.webos.service.networkinput/getPointerInputSocket") {
        socket.message({
          id: message.id,
          type: "response",
          payload: { returnValue: true, socketPath: "wss://192.0.2.20:3001/pointer" },
        });
      }
    };
    const value = connection();
    await value.connect();
    const pending = value.getInputSocket({ timeoutMs: 100 });
    pointerSocket?.open();
    const closed = value.disconnect();

    await expect(pending).rejects.toThrow("Connection closed");
    await expect(closed).resolves.toBeUndefined();
    expect(pointerSocket?.closeCalls).toBe(1);
    await expect(value.getInputSocket()).rejects.toThrow("Not connected");
  });
});
