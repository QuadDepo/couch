import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    let sockets = 0;
    let sends = 0;
    const failingConnection: WebOSConnection = {
      ...connection,
      getInputSocket: async () => {
        sockets += 1;
        return {
          send: () => {
            sends += 1;
            throw new Error("socket closed after write may have started");
          },
          close: () => undefined,
        };
      },
    };
    const driver = createLgWebosDriver(
      { ip: "192.0.2.20", credentials },
      { connection: failingConnection },
    );
    await driver.open();
    await expect(driver.execute({ kind: "control.press", key: "LEFT" })).rejects.toThrow(
      "socket closed after write may have started",
    );
    expect({ sockets, sends }).toEqual({ sockets: 1, sends: 1 });
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

  test("lists installed apps before launch and observes foreground state", async () => {
    const { connection, calls } = fakeWebos();
    const responses: Record<string, unknown> = {
      "ssap://com.webos.applicationManager/listApps": { apps: [{ id: "com.example.app" }] },
      "ssap://system.launcher/launch": { returnValue: true },
      "ssap://com.webos.applicationManager/getForegroundAppInfo": {
        appId: "com.example.app",
      },
    };
    connection.request = async <T>(uri: string, payload?: object): Promise<T> => {
      calls.push(`request:${uri}:${JSON.stringify(payload)}`);
      return responses[uri] as T;
    };
    const driver = createLgWebosDriver({ ip: "192.0.2.20", credentials }, { connection });
    await driver.open();

    await driver.execute({
      kind: "app.launch",
      appId: "com.example.app",
      params: { contentId: "featured" },
    });
    const foreground = await driver.execute({
      kind: "app.foreground",
      appId: "com.example.app",
    });

    expect(calls).toEqual([
      "request:ssap://com.webos.applicationManager/listApps:{}",
      'request:ssap://system.launcher/launch:{"id":"com.example.app","params":{"contentId":"featured"}}',
      "request:ssap://com.webos.applicationManager/getForegroundAppInfo:{}",
    ]);
    expect(foreground.metadata).toEqual({
      expectedAppId: "com.example.app",
      foregroundAppId: "com.example.app",
      foreground: true,
    });
  });

  test("captures a validated JPEG without publishing the SSAP URI", async () => {
    const directory = await mkdtemp(join(tmpdir(), "couch-webos-driver-"));
    const path = join(directory, "actual.jpg");
    const { connection } = fakeWebos();
    connection.request = async <T>(): Promise<T> =>
      ({ imageUri: "http://192.0.2.20/capture.jpg?token=secret" }) as T;
    const bytes = new Uint8Array([0xff, 0xd8, 1, 0xff, 0xd9]);
    const driver = createLgWebosDriver(
      { ip: "192.0.2.20", credentials },
      {
        connection,
        fetch: async () => new Response(bytes, { headers: { "content-type": "image/jpeg" } }),
      },
    );
    await driver.open();

    const receipt = await driver.execute({ kind: "screen.capture", format: "jpg", path });

    expect(new Uint8Array(await readFile(path))).toEqual(bytes);
    expect(receipt.artifacts?.[0]).toEqual({
      path,
      type: "screenshot",
      mimeType: "image/jpeg",
      metadata: { byteLength: 5, format: "jpg", dimensions: "unavailable" },
    });
    expect(JSON.stringify(receipt)).not.toContain("secret");
  });

  test("rejects malformed lifecycle responses before reading fields", async () => {
    const { connection } = fakeWebos();
    connection.request = async <T>(): Promise<T> => ({ apps: [{ title: "Missing ID" }] }) as T;
    const driver = createLgWebosDriver({ ip: "192.0.2.20", credentials }, { connection });
    await driver.open();

    await expect(driver.execute({ kind: "app.launch", appId: "com.example.app" })).rejects.toThrow(
      "invalid app list response",
    );
  });

  test.each([
    ["app.foreground", { returnValue: true }, "invalid foreground app response"],
    ["screen.capture", { returnValue: true }, "invalid capture response"],
  ] as const)("rejects malformed %s payloads", async (kind, response, message) => {
    const { connection } = fakeWebos();
    connection.request = async <T>(): Promise<T> => response as T;
    const driver = createLgWebosDriver({ ip: "192.0.2.20", credentials }, { connection });
    await driver.open();
    const operation =
      kind === "app.foreground"
        ? ({ kind, appId: "com.example.app" } as const)
        : ({ kind, path: "/tmp/capture.jpg" } as const);

    await expect(driver.execute(operation)).rejects.toThrow(message);
  });

  test("sanitizes SSAP authorization failures with repair remediation", async () => {
    const { connection } = fakeWebos();
    connection.request = async () => {
      throw new Error("Request failed: 403 permission denied at ssap://secret?client-key=raw");
    };
    const driver = createLgWebosDriver({ ip: "192.0.2.20", credentials }, { connection });
    await driver.open();

    await expect(driver.execute({ kind: "app.foreground", appId: "app" })).rejects.toMatchObject({
      code: "WEBOS_AUTHORIZATION_REQUIRED",
      message:
        "LG webOS denied the operation; explicitly re-pair the TV outside the test before retrying.",
    });
  });

  test("rejects JPEG capture paths with a misleading extension before requesting capture", async () => {
    const { connection, calls } = fakeWebos();
    const driver = createLgWebosDriver({ ip: "192.0.2.20", credentials }, { connection });
    await driver.open();

    await expect(
      driver.execute({ kind: "screen.capture", path: "/tmp/actual.png" }),
    ).rejects.toThrow(".jpg or .jpeg");
    expect(calls).toEqual([]);
  });
});
