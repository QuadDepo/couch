import { describe, expect, test } from "bun:test";
import type { WebOSConnection } from "./connectionTypes";
import { createLgWebosDriver } from "./driver";
import { credentials, fakeWebos } from "./driverTestSupport";

describe("LG webOS driver", () => {
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
