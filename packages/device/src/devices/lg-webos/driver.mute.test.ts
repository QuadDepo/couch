import { describe, expect, test } from "bun:test";
import type { WebOSConnection } from "./connectionTypes";
import { createLgWebosDriver } from "./driver";
import { credentials, fakeWebos } from "./driverTestSupport";

describe("LG webOS driver mute state", () => {
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
});
