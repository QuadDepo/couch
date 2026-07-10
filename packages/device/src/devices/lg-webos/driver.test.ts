import { describe, expect, test } from "bun:test";
import type { RemoteInputSocket, WebOSConnection } from "./connection";
import { createLgWebosDriver } from "./driver";

function fakeWebos() {
  const calls: string[] = [];
  let connected = false;
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const socket: RemoteInputSocket = {
    send: (type, payload) => calls.push(`socket:${type}:${JSON.stringify(payload)}`),
    close: () => calls.push("socket:close"),
  };
  const connection: WebOSConnection = {
    connect: async () => {
      connected = true;
      listeners.get("connect")?.();
    },
    disconnect: () => {
      connected = false;
      calls.push("disconnect");
    },
    request: async (uri) => {
      calls.push(`request:${uri}`);
      return {};
    },
    subscribe: async () => undefined,
    getInputSocket: async () => socket,
    on: (event, callback) => {
      listeners.set(event, callback as (...args: unknown[]) => void);
    },
    isConnected: () => connected,
    isPaired: () => true,
    getClientKey: () => "client-key",
  };
  return { connection, calls };
}

const credentials = { clientKey: "client-key", mac: "", useSsl: false, lastUpdated: "now" };

describe("LG webOS driver", () => {
  test("uses the initial mute status before the first toggle", async () => {
    const { connection, calls } = fakeWebos();
    const status = { mute: true };
    let payloadSeen: object | undefined;
    let getStatusRequests = 0;
    const request = connection.request;
    const initialConnection: WebOSConnection = {
      ...connection,
      request: async (uri, payload, options) => {
        if (uri === "ssap://audio/getStatus") {
          getStatusRequests += 1;
          return status;
        }
        if (uri === "ssap://audio/setMute") payloadSeen = payload;
        return request(uri, payload, options);
      },
      subscribe: async (_uri, _payload, callback) => callback(status),
    };
    const driver = createLgWebosDriver(
      { ip: "192.0.2.20", credentials },
      { connection: initialConnection },
    );
    await driver.open();

    await driver.execute({ kind: "control.press", key: "MUTE" });

    expect(calls).toContain("request:ssap://audio/setMute");
    expect(payloadSeen).toEqual({ mute: false });
    expect(getStatusRequests).toBe(0);
  });

  test("updates mute state from subscription events", async () => {
    const { connection, calls } = fakeWebos();
    const listeners: ((data: { mute: boolean }) => void)[] = [];
    let payloadSeen: object | undefined;
    const subscribedConnection: WebOSConnection = {
      ...connection,
      request: async (uri, payload, options) => {
        if (uri === "ssap://audio/setMute") payloadSeen = payload;
        return connection.request(uri, payload, options);
      },
      subscribe: async (_uri, _payload, callback) => {
        listeners.push(callback);
        callback({ mute: false });
      },
    };
    const driver = createLgWebosDriver(
      { ip: "192.0.2.20", credentials },
      { connection: subscribedConnection },
    );
    await driver.open();
    listeners[0]?.({ mute: true });
    await driver.execute({ kind: "control.press", key: "MUTE" });

    expect(calls).toContain("request:ssap://audio/setMute");
    expect(payloadSeen).toEqual({ mute: false });
  });

  test("commits the requested mute state when a subscription updates during the request", async () => {
    const { connection } = fakeWebos();
    const muteEvents: boolean[] = [];
    let subscriptionCallback: ((data: { mute: boolean }) => void) | undefined;
    let payloadSeen: object | undefined;
    const racingConnection: WebOSConnection = {
      ...connection,
      request: async (uri, payload, options) => {
        if (uri === "ssap://audio/setMute") {
          payloadSeen = payload;
          subscriptionCallback?.({ mute: true });
        }
        return connection.request(uri, payload, options);
      },
      subscribe: async (_uri, _payload, callback) => {
        subscriptionCallback = callback;
        callback({ mute: false });
      },
    };
    const driver = createLgWebosDriver(
      { ip: "192.0.2.20", credentials },
      { connection: racingConnection, onMuteStateChanged: (mute) => muteEvents.push(mute) },
    );
    await driver.open();

    await driver.execute({ kind: "control.press", key: "MUTE" });

    expect(payloadSeen).toEqual({ mute: true });
    expect(muteEvents.at(-1)).toBe(true);
  });

  test("serializes rapid mute presses into alternating target states", async () => {
    const { connection } = fakeWebos();
    const mutePayloads: object[] = [];
    let releaseFirstRequest: (() => void) | undefined;
    const firstRequest = new Promise<void>((resolve) => {
      releaseFirstRequest = resolve;
    });
    const serializedConnection: WebOSConnection = {
      ...connection,
      request: async (uri, payload, options) => {
        if (uri === "ssap://audio/setMute") {
          mutePayloads.push(payload);
          if (mutePayloads.length === 1) await firstRequest;
        }
        return connection.request(uri, payload, options);
      },
      subscribe: async (_uri, _payload, callback) => callback({ mute: false }),
    };
    const driver = createLgWebosDriver(
      { ip: "192.0.2.20", credentials },
      { connection: serializedConnection },
    );
    await driver.open();

    const firstPress = driver.execute({ kind: "control.press", key: "MUTE" });
    await Promise.resolve();
    const secondPress = driver.execute({ kind: "control.press", key: "MUTE" });
    await Promise.resolve();

    expect(mutePayloads).toEqual([{ mute: true }]);
    releaseFirstRequest?.();
    await Promise.all([firstPress, secondPress]);

    expect(mutePayloads).toEqual([{ mute: true }, { mute: false }]);
  });

  test("uses transport-write for pointer input and protocol-response for SSAP", async () => {
    const { connection, calls } = fakeWebos();
    const driver = createLgWebosDriver({ ip: "192.0.2.20", credentials }, { connection });
    await driver.open();

    const pointerReceipt = await driver.execute(
      { kind: "control.press", key: "LEFT" },
      { signal: new AbortController().signal },
    );
    const ssapReceipt = await driver.execute(
      { kind: "control.press", key: "VOLUME_UP" },
      { signal: new AbortController().signal },
    );

    expect(pointerReceipt.confirmation).toBe("transport-write");
    expect(ssapReceipt.confirmation).toBe("protocol-response");
    expect(calls[0]).toContain("socket:button");
    expect(calls[1]).toContain("request:ssap://audio/volumeUp");
  });

  test("closes idempotently", async () => {
    const { connection, calls } = fakeWebos();
    const driver = createLgWebosDriver({ ip: "192.0.2.20", credentials }, { connection });
    await driver.open();
    await driver.close();
    await driver.close();
    expect(calls).toEqual(["disconnect"]);
  });

  test("can be reopened after close", async () => {
    const { connection, calls } = fakeWebos();
    const driver = createLgWebosDriver({ ip: "192.0.2.20", credentials }, { connection });
    await driver.open();
    await driver.close();
    await driver.open();
    await driver.close();
    expect(calls).toEqual(["disconnect", "disconnect"]);
  });

  test("does not report transport-write when input transport rejects a write", async () => {
    const { connection } = fakeWebos();
    const failingConnection: WebOSConnection = {
      ...connection,
      getInputSocket: async () => ({
        send: () => {
          throw new Error("socket closed");
        },
        close: () => undefined,
      }),
    };
    const driver = createLgWebosDriver(
      { ip: "192.0.2.20", credentials },
      { connection: failingConnection },
    );
    await driver.open();
    await expect(driver.execute({ kind: "control.press", key: "LEFT" })).rejects.toThrow(
      "socket closed",
    );
  });

  test("preserves the webOS enter flow and reports its transport-write strength", async () => {
    const { connection, calls } = fakeWebos();
    const driver = createLgWebosDriver({ ip: "192.0.2.20", credentials }, { connection });
    await driver.open();

    const receipt = await driver.execute({ kind: "control.text", text: "\n" });

    expect(calls).toEqual([
      "request:ssap://com.webos.service.ime/sendEnterKey",
      'socket:button:{"name":"ENTER"}',
    ]);
    expect(receipt.confirmation).toBe("transport-write");
  });
});
