import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { openPointerInput } from "./pointerInput";

type Event = Record<string, unknown>;
type EventListener = (event: Event) => void;

class MockWebSocket {
  static readonly instances: MockWebSocket[] = [];
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readonly listeners = new Map<string, Set<EventListener>>();
  readonly url: string;
  readyState = 0;
  closeCalls = 0;
  sendError: Error | undefined;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: Event = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open", { type: "open" });
  }

  close(): void {
    this.closeCalls += 1;
    this.readyState = MockWebSocket.CLOSED;
  }

  send(): void {
    if (this.sendError) throw this.sendError;
  }
}

const nativeWebSocket = globalThis.WebSocket;

function options(onClose: () => void, timeout = 100): Parameters<typeof openPointerInput>[0] {
  return {
    ip: "192.0.2.20",
    socketPath: "/pointer?token=secret&client-key=pairing-material",
    timeout,
    useSsl: false,
    onClose,
  };
}

function socket(): MockWebSocket {
  const value = MockWebSocket.instances[0];
  if (!value) throw new Error("socket was not created");
  return value;
}

beforeEach(() => {
  MockWebSocket.instances.length = 0;
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  globalThis.WebSocket = nativeWebSocket;
});

describe("LG webOS pointer input", () => {
  test("normalizes an ErrorEvent with a safe cause and code", async () => {
    const pending = openPointerInput(options(() => undefined));
    const cause = Object.assign(
      new Error("connect failed at ws://192.0.2.20:3000/pointer?token=secret"),
      {
        code: "ECONNRESET",
      },
    );
    socket().emit("error", {
      message:
        "pointer failed at ws://192.0.2.20:3000/pointer?token=secret&client-key=pairing-material",
      error: cause,
    });

    const error = await pending.catch((value) => value);
    expect(error).toMatchObject({ code: "WEBOS_POINTER_SOCKET_ERROR" });
    expect(error.message).toContain("pointer failed");
    expect(error.cause).toMatchObject({ code: "ECONNRESET" });
    expect(JSON.stringify(error)).not.toMatch(/pointer\?token=secret|client-key=pairing-material/);
  });

  test("classifies an open timeout separately", async () => {
    const pending = openPointerInput(options(() => undefined, 1));
    const error = await pending.catch((value) => value);

    expect(error).toMatchObject({ code: "WEBOS_POINTER_OPEN_TIMEOUT" });
    expect(error.message).toContain("readyState=0");
    expect(error.message).toContain("endpoint=ws://192.0.2.20:3000");
  });

  test("rejects an insecure absolute pointer URL for an SSL connection", () => {
    expect(() =>
      openPointerInput({
        ...options(() => undefined),
        socketPath: "ws://192.0.2.20:3000/pointer?token=secret",
        useSsl: true,
      }),
    ).toThrow("must use WSS");
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  test("normalizes a close event before open", async () => {
    const pending = openPointerInput(options(() => undefined));
    socket().emit("close", {
      code: 1008,
      reason: "rejected /pointer?token=secret&client-key=pairing-material",
    });

    const error = await pending.catch((value) => value);
    expect(error).toMatchObject({ code: "WEBOS_POINTER_SOCKET_CLOSED" });
    expect(error.message).toContain("code=1008");
    expect(error.message).toContain("reason=rejected");
    expect(JSON.stringify(error)).not.toMatch(/token=secret|client-key=pairing-material/);
  });

  test("lets a delayed policy close classify an earlier pre-open error", async () => {
    const pending = openPointerInput(options(() => undefined, 100));
    socket().emit("error", { message: "transport failed" });
    await Bun.sleep(40);
    socket().emit("close", { code: 1008, reason: "policy rejected token=secret" });

    await expect(pending).rejects.toMatchObject({
      code: "WEBOS_POINTER_SOCKET_CLOSED",
      retryable: false,
    });
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  test("keeps remote close and error listeners after open and invalidates once", async () => {
    let closes = 0;
    const pending = openPointerInput(
      options(() => {
        closes += 1;
      }),
    );
    const value = socket();
    value.open();
    await pending;

    value.emit("error", { message: "remote input failed" });
    value.emit("close", { code: 1006, reason: "remote failure" });

    expect(closes).toBe(1);
  });

  test("invalidates before throwing when a stale send sees a closed socket", async () => {
    let closes = 0;
    const pending = openPointerInput(
      options(() => {
        closes += 1;
      }),
    );
    const value = socket();
    value.open();
    const remote = await pending;

    value.readyState = MockWebSocket.CLOSED;
    expect(() => remote.send("move", { dx: 1 })).toThrow("Input socket is not connected");

    expect(closes).toBe(1);
  });

  test("makes explicit close idempotent", async () => {
    let closes = 0;
    const pending = openPointerInput(
      options(() => {
        closes += 1;
      }),
    );
    const value = socket();
    value.open();
    const remote = await pending;

    remote.close();
    remote.close();

    expect(value.closeCalls).toBe(1);
    expect(closes).toBe(1);
  });

  test("invalidates a socket after a write throws without replaying the write", async () => {
    let closes = 0;
    const pending = openPointerInput(
      options(() => {
        closes += 1;
      }),
    );
    const value = socket();
    value.open();
    const remote = await pending;
    value.sendError = new Error("write failed token=standalone-secret");

    let thrown: unknown;
    try {
      remote.send("button", { name: "LEFT" });
    } catch (error) {
      thrown = error;
    }
    expect(String(thrown)).toContain("write failed");
    expect(String(thrown)).not.toContain("standalone-secret");
    expect(closes).toBe(1);
  });
});
