import { describe, expect, test } from "bun:test";
import type { DeviceSession } from "@couch/device";
import type { CouchTestConfig } from "@couch/runner/config";
import { runCli } from "./cli";
import { inventoryWithSession, operationRecord, output, signalTarget } from "./testSupport/fakes";

const config: CouchTestConfig = {
  configVersion: 1,
  targets: {
    lab: {
      deviceId: "android-1",
      app: { id: "com.example.app", activity: ".MainActivity" },
    },
  },
};

const commands = [
  ["launch", ["app", "launch", "lab", "--json"]],
  ["foreground", ["app", "foreground", "lab", "--json"]],
  ["screenshot", ["screenshot", "lab", "--out", "actual.png", "--json"]],
] as const;

describe("CLI command cancellation", () => {
  test.each(
    commands,
  )("%s maps cancelled records to SIGINT and SIGTERM exits", async (_name, args) => {
    for (const [signal, expectedExit] of [
      ["SIGINT", 130],
      ["SIGTERM", 143],
    ] as const) {
      const target = signalTarget();
      const io = output();
      const session: DeviceSession = {
        capabilities: new Map(),
        async execute(operation) {
          target.emit(signal);
          return operationRecord(operation, "cancelled");
        },
        close: async () => undefined,
      };
      const exitCode = await runCli(args, {
        createInventory: () => inventoryWithSession(session),
        loadConfig: async () => config,
        signalTarget: target,
        stdout: io.writeOut,
        stderr: io.writeErr,
      });
      expect(exitCode).toBe(expectedExit);
      expect(io.stdout).toHaveLength(1);
      expect(JSON.parse(io.stdout[0] ?? "{}")).toMatchObject({
        status: "cancelled",
        exitCode: expectedExit,
      });
      expect(target.removed).toEqual(["SIGINT", "SIGTERM"]);
    }
  });

  test("cancellation preserves its exit when close fails", async () => {
    const target = signalTarget();
    const io = output();
    const session: DeviceSession = {
      capabilities: new Map(),
      async execute(operation) {
        target.emit("SIGINT");
        return operationRecord(operation, "cancelled");
      },
      close: async () => {
        throw new Error("lock retained");
      },
    };
    expect(
      await runCli(["app", "launch", "lab", "--json"], {
        createInventory: () => inventoryWithSession(session),
        loadConfig: async () => config,
        signalTarget: target,
        stdout: io.writeOut,
        stderr: io.writeErr,
      }),
    ).toBe(130);
    expect(JSON.parse(io.stdout[0] ?? "{}").cleanupError.message).toContain("lock retained");
    expect(io.stderr.join("")).toContain("lock retained");
  });
});

describe("CLI command failures", () => {
  test.each(commands)("%s fails a successful operation when close fails", async (_name, args) => {
    const io = output();
    const session: DeviceSession = {
      capabilities: new Map(),
      execute: async (operation) =>
        operationRecord(
          operation,
          "succeeded",
          operation.kind === "app.foreground" ? { foreground: true } : undefined,
        ),
      close: async () => {
        throw new Error("close failed");
      },
    };
    const exitCode = await runCli(args, {
      createInventory: () => inventoryWithSession(session),
      loadConfig: async () => config,
      signalTarget: signalTarget(),
      stdout: io.writeOut,
      stderr: io.writeErr,
    });
    expect(exitCode).toBe(2);
    expect(JSON.parse(io.stdout[0] ?? "{}")).toMatchObject({
      status: "failed",
      exitCode: 2,
      cleanupError: { message: "close failed" },
    });
    expect(io.stderr.join("")).toContain("close failed");
  });

  test.each([
    ["screenshot", ["screenshot", "lab", "--out", "actual.png", "--json"]],
    ["foreground", ["app", "foreground", "lab", "--json"]],
  ] as const)("%s preserves transport failures", async (_name, args) => {
    const io = output();
    const session: DeviceSession = {
      capabilities: new Map(),
      execute: async (operation) => operationRecord(operation, "failed"),
      close: async () => undefined,
    };
    expect(
      await runCli(args, {
        createInventory: () => inventoryWithSession(session),
        loadConfig: async () => config,
        signalTarget: signalTarget(),
        stdout: io.writeOut,
        stderr: io.writeErr,
      }),
    ).toBe(2);
    expect(JSON.parse(io.stdout[0] ?? "{}").error).toEqual({
      code: "adb-failed",
      message: "ADB transport failed",
    });
    expect(io.stderr.join("")).toContain("ADB transport failed");
  });

  test.each([
    ["screenshot", ["screenshot", "lab", "--out", "--json"]],
    ["test", ["test", "smoke.tv.ts", "--target", "--json"]],
  ] as const)("%s rejects option-looking values", async (_name, args) => {
    let created = false;
    const io = output();
    expect(
      await runCli(args, {
        createInventory: () => {
          created = true;
          throw new Error("unexpected");
        },
        stdout: io.writeOut,
        stderr: io.writeErr,
      }),
    ).toBe(64);
    expect(created).toBe(false);
  });

  test("couch test preserves runner cleanup errors in JSON and stderr", async () => {
    const io = output();
    const session: DeviceSession = {
      capabilities: new Map(),
      execute: async (operation) => operationRecord(operation, "succeeded"),
      close: async () => undefined,
    };
    expect(
      await runCli(["test", "smoke.tv.ts", "--target", "lab", "--json"], {
        createInventory: () => inventoryWithSession(session),
        runTvTest: async () => ({
          result: {
            resultVersion: 1,
            status: "infrastructure-failed",
            exitCode: 2,
            assertions: [],
            error: { code: "cleanup-failed", message: "cleanup stop failed" },
            cleanupError: { code: "cleanup-failed", message: "cleanup stop failed" },
          },
        }),
        signalTarget: signalTarget(),
        stdout: io.writeOut,
        stderr: io.writeErr,
      }),
    ).toBe(2);
    expect(JSON.parse(io.stdout[0] ?? "{}").cleanupError).toEqual({
      code: "cleanup-failed",
      message: "cleanup stop failed",
    });
    expect(io.stderr.join("")).toContain("cleanup stop failed");
  });
});
