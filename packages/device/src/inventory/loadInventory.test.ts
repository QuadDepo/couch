import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TVDevice } from "../types";
import { InventoryError, loadDevicesFromFile, saveDevicesToFile } from "./loadInventory";

const tempDirectories: string[] = [];

async function makeStoragePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "couch-storage-"));
  tempDirectories.push(directory);
  return join(directory, "devices.json");
}

const device: TVDevice = {
  id: "device-1",
  name: "Living Room",
  platform: "lg-webos",
  ip: "192.168.1.20",
  config: {
    webos: {
      clientKey: "client-key",
      mac: "",
      useSsl: false,
      lastUpdated: "2026-01-01T00:00:00.000Z",
    },
  },
};

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("device inventory storage", () => {
  test("round-trips a validated inventory file", async () => {
    const path = await makeStoragePath();

    await saveDevicesToFile(path, [device]);

    expect(await loadDevicesFromFile(path)).toEqual([device]);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(path, ".."))).mode & 0o777).toBe(0o700);
  });

  test("returns null when the inventory file is missing", async () => {
    const path = await makeStoragePath();

    expect(await loadDevicesFromFile(path)).toBeNull();
  });

  test("validates credentials without rewriting stored config", async () => {
    const path = await makeStoragePath();
    const stored = {
      ...device,
      config: { webos: { clientKey: "client-key", custom: "preserved" } },
    };
    await Bun.write(path, JSON.stringify({ version: 1, devices: [stored] }));

    expect(await loadDevicesFromFile(path)).toEqual([stored]);
  });

  test("throws InventoryError for malformed inventory data", async () => {
    const path = await makeStoragePath();
    await Bun.write(path, JSON.stringify({ version: 1, devices: [{ ...device, id: 3 }] }));

    await expect(loadDevicesFromFile(path)).rejects.toBeInstanceOf(InventoryError);
  });

  test("throws InventoryError for an unsupported schema version", async () => {
    const path = await makeStoragePath();
    await Bun.write(path, JSON.stringify({ version: 2, devices: [] }));

    const error = loadDevicesFromFile(path);

    await expect(error).rejects.toMatchObject({ code: "UNSUPPORTED_VERSION" });
  });

  test("throws InventoryError when credentials do not match the platform", async () => {
    const path = await makeStoragePath();
    await Bun.write(
      path,
      JSON.stringify({
        version: 1,
        devices: [{ ...device, config: { webos: { clientKey: "" } } }],
      }),
    );

    await expect(loadDevicesFromFile(path)).rejects.toBeInstanceOf(InventoryError);
  });

  test("propagates save failures as InventoryError", async () => {
    const directory = await mkdtemp(join(tmpdir(), "couch-storage-"));
    tempDirectories.push(directory);

    await expect(saveDevicesToFile(directory, [device])).rejects.toBeInstanceOf(InventoryError);
  });
});
