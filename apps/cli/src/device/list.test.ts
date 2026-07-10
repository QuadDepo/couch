import { describe, expect, test } from "bun:test";
import type { DeviceInventory } from "@couch/device";
import { runCli } from "../cli";
import { output } from "../testSupport/fakes";

describe("device list", () => {
  test("sorts credential-safe descriptors in one JSON document", async () => {
    const result = output();
    const inventory: DeviceInventory = {
      listDevices: async () => [
        { id: "webos", name: "WebOS", platform: "webos", ip: "192.0.2.2", driverId: "lg-ssap" },
        {
          id: "android",
          name: "Android",
          platform: "android-tv",
          ip: "192.0.2.1",
          driverId: "adb",
        },
      ],
      getDevice: async () => {
        throw new Error("unreachable");
      },
      getCapabilities: async () => new Map(),
      openSession: async () => {
        throw new Error("unreachable");
      },
    };
    const exit = await runCli(["device", "list", "--json"], {
      createInventory: () => inventory,
      stdout: result.writeOut,
      stderr: result.writeErr,
    });
    expect(exit).toBe(0);
    expect(JSON.parse(result.stdout[0] ?? "")).toMatchObject({
      command: "device.list",
      status: "succeeded",
      devices: [{ id: "android" }, { id: "webos" }],
    });
    expect(result.stderr).toEqual([]);
  });

  test("prints a stable human table", async () => {
    const result = output();
    const inventory: DeviceInventory = {
      listDevices: async () => [
        { id: "lab", name: "Living Room", platform: "webos", ip: "192.0.2.2", driverId: "lg-ssap" },
      ],
      getDevice: async () => {
        throw new Error("unreachable");
      },
      getCapabilities: async () => new Map(),
      openSession: async () => {
        throw new Error("unreachable");
      },
    };
    await runCli(["device", "list"], {
      createInventory: () => inventory,
      stdout: result.writeOut,
      stderr: result.writeErr,
    });
    expect(result.stdout[0]).toBe(
      "ID\tNAME\tPLATFORM\tDRIVER\tADDRESS\nlab\tLiving Room\twebos\tlg-ssap\t192.0.2.2\n",
    );
  });

  test("uses a structured infrastructure failure", async () => {
    const result = output();
    const exit = await runCli(["device", "list", "--json"], {
      createInventory: () => {
        throw new Error("inventory unavailable");
      },
      stdout: result.writeOut,
      stderr: result.writeErr,
    });
    expect(exit).toBe(2);
    expect(JSON.parse(result.stdout[0] ?? "")).toMatchObject({
      command: "device.list",
      status: "failed",
      error: { code: "runtime-failed", message: "inventory unavailable" },
    });
  });
});
