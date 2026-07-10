import { describe, expect, test } from "bun:test";
import type { ADBConnection } from "./connection";
import { createAndroidTvDriver } from "./driver";

function fakeAdb() {
  const calls: string[] = [];
  const adb: ADBConnection = {
    connect: async () => calls.push("connect"),
    disconnect: async () => calls.push("disconnect"),
    sendKeyEvent: async (key) => calls.push(`key:${key}`),
    sendText: async (text) => calls.push(`text:${text}`),
    pair: async () => undefined,
    isConnected: async () => true,
  };
  return { adb, calls };
}

describe("Android TV driver", () => {
  test("opens without waking and reports process-exit confirmation", async () => {
    const { adb, calls } = fakeAdb();
    const driver = createAndroidTvDriver({ ip: "192.0.2.10" }, { connection: adb });

    await driver.open();
    const receipt = await driver.execute(
      { kind: "control.press", key: "LEFT" },
      { signal: new AbortController().signal },
    );

    expect(calls).toEqual(["connect", "key:KEYCODE_DPAD_LEFT"]);
    expect(receipt.confirmation).toBe("process-exit");
  });

  test("makes wake explicit and closes idempotently", async () => {
    const { adb, calls } = fakeAdb();
    const driver = createAndroidTvDriver({ ip: "192.0.2.10" }, { connection: adb });

    await driver.open();
    await driver.execute({ kind: "device.wake" }, { signal: new AbortController().signal });
    await driver.close();
    await driver.close();

    expect(calls).toEqual(["connect", "key:KEYCODE_WAKEUP", "disconnect"]);
  });

  test("can be reopened after close", async () => {
    const { adb, calls } = fakeAdb();
    const driver = createAndroidTvDriver({ ip: "192.0.2.10" }, { connection: adb });
    await driver.open();
    await driver.close();
    await driver.open();
    await driver.close();
    expect(calls).toEqual(["connect", "disconnect", "connect", "disconnect"]);
  });

  test("checks the live ADB connection when reporting readiness", async () => {
    const { adb } = fakeAdb();
    adb.isConnected = async () => false;
    const driver = createAndroidTvDriver({ ip: "192.0.2.10" }, { connection: adb });

    await driver.open();

    expect(await driver.isReady()).toBe(false);
  });
});
