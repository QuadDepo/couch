import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDriverRegistry } from "../drivers/registry";
import type { OperationCapability, OperationKind } from "../operations/types";
import { fakeDriver, registration, testDevice } from "../sessions/testSupport";
import { createDeviceInventory } from "./deviceInventory";
import type { PersistedDevice } from "./types";

const webos = (clientKey?: string): PersistedDevice => ({
  id: "webos",
  name: "WebOS",
  platform: "lg-webos",
  ip: "192.168.1.51",
  ...(clientKey ? { config: { webos: { clientKey } } } : {}),
});

describe("DeviceInventory preflight", () => {
  test.each([
    ["missing-tool", [Object.assign(new Error("adb not found"), { code: "ENOENT" })]],
    ["unauthorized", ["connected", "error: device unauthorized"]],
    ["offline", ["failed to connect: Connection refused"]],
  ] as const)("reports Android %s readiness without opening a session", async (expected, outputs) => {
    let index = 0;
    const inventory = createDeviceInventory({
      inventoryLoader: () => [testDevice],
      registry: createDriverRegistry({
        androidTvDependencies: {
          runCommand: async () => {
            const output = outputs[index++];
            if (output instanceof Error) throw output;
            return output ?? "";
          },
        },
      }),
    });

    const capability = (await inventory.getCapabilities(testDevice.id)).get("control.press");

    expect(capability?.readiness).toBe(expected);
    expect(capability?.constraints).toEqual({ readinessCheck: "live-adb-probe" });
  });

  test("reports paired and misconfigured webOS readiness", async () => {
    const paired = createDeviceInventory({ inventoryLoader: () => [webos("client-key")] });
    const missing = createDeviceInventory({ inventoryLoader: () => [webos()] });

    expect((await paired.getCapabilities("webos")).get("control.press")).toMatchObject({
      readiness: "ready",
      reason: "Paired client key configured; live connectivity was not checked",
      constraints: { readinessCheck: "paired-configuration-only" },
    });
    expect((await missing.getCapabilities("webos")).get("control.press")).toMatchObject({
      readiness: "misconfigured",
      reason: "LG webOS requires a paired client key",
    });
  });

  test("requires explicit approval for experimental operations", async () => {
    const driver = fakeDriver();
    const capability: OperationCapability = { support: "experimental", readiness: "ready" };
    const inventory = createDeviceInventory({
      inventoryLoader: () => [testDevice],
      registry: {
        getRegistration: () => ({
          ...registration(driver),
          getCapabilities: () =>
            new Map<OperationKind, OperationCapability>([["control.press", capability]]),
        }),
      },
    });

    await expect(
      inventory.openSession(testDevice.id, { require: ["control.press"] }),
    ).rejects.toMatchObject({ code: "experimental-operation" });
  });

  test("normalizes capability records from custom registrations", async () => {
    const inventory = createDeviceInventory({
      inventoryLoader: () => [testDevice],
      registry: {
        getRegistration: () => ({
          ...registration(fakeDriver()),
          getCapabilities: () => ({
            "control.press": { support: "stable", readiness: "ready" },
          }),
        }),
      },
    });

    expect(await inventory.getCapabilities(testDevice.id)).toEqual(
      new Map([["control.press", { support: "stable", readiness: "ready" }]]),
    );
  });

  test("does no work for an already-aborted open", async () => {
    let probes = 0;
    let creations = 0;
    const directory = await mkdtemp(join(tmpdir(), "couch-pre-abort-"));
    const lockDirectory = join(directory, "locks");
    const controller = new AbortController();
    controller.abort(new Error("open cancelled"));
    const inventory = createDeviceInventory({
      inventoryLoader: () => [testDevice],
      lockDirectory,
      registry: {
        getRegistration: () => ({
          ...registration(fakeDriver()),
          createDriver: () => {
            creations += 1;
            return fakeDriver();
          },
          getCapabilities: () => {
            probes += 1;
            return new Map();
          },
        }),
      },
    });

    await expect(
      inventory.openSession(testDevice.id, { require: [], signal: controller.signal }),
    ).rejects.toThrow("open cancelled");
    expect([probes, creations]).toEqual([0, 0]);
    await expect(stat(lockDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    await rm(directory, { recursive: true });
  });

  test.each([
    "getCapabilities",
    "openSession",
  ] as const)("cancels a non-cooperative %s probe before driver or lock creation", async (method) => {
    let started!: () => void;
    const probeStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const probe = new Promise<ReadonlyMap<OperationKind, OperationCapability>>(() => undefined);
    let creations = 0;
    const directory = await mkdtemp(join(tmpdir(), "couch-probe-abort-"));
    const lockDirectory = join(directory, "locks");
    const inventory = createDeviceInventory({
      inventoryLoader: () => [testDevice],
      lockDirectory,
      registry: {
        getRegistration: () => ({
          ...registration(fakeDriver()),
          createDriver: () => {
            creations += 1;
            return fakeDriver();
          },
          getCapabilities: () => {
            started();
            return probe;
          },
        }),
      },
    });
    const controller = new AbortController();
    const result =
      method === "getCapabilities"
        ? inventory.getCapabilities(testDevice.id, { signal: controller.signal })
        : inventory.openSession(testDevice.id, { require: [], signal: controller.signal });
    await probeStarted;
    controller.abort(new Error("probe cancelled"));

    await expect(result).rejects.toThrow("probe cancelled");
    expect(creations).toBe(0);
    await expect(stat(lockDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    await rm(directory, { recursive: true });
  });
});
