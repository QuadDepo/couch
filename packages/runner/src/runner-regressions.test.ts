import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { mkdtemp, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type {
  DeviceInventory,
  DeviceInventoryOptions,
  DeviceOperation,
  DeviceSession,
  OperationKind,
  OperationRecord,
} from "@couch/device";
import { createDeviceInventory } from "@couch/device";
import { runTvTest, validateTestResult, validateTestTrace } from "./runner";

const ready = { support: "stable", readiness: "ready" } as const;
const kinds: OperationKind[] = [
  "app.stop",
  "app.launch",
  "app.foreground",
  "control.press",
  "screen.capture",
];

function record(
  operation: DeviceOperation,
  ordinal: number,
  status: OperationRecord["status"] = "succeeded",
  metadata?: Record<string, unknown>,
): OperationRecord {
  return {
    id: crypto.randomUUID(),
    ordinal,
    kind: operation.kind,
    adapterId: "adb",
    status,
    ...(status === "succeeded" ? { confirmation: "process-exit" as const } : {}),
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    input: operation,
    artifacts: [],
    ...(metadata ? { metadata } : {}),
    ...(status === "succeeded"
      ? {}
      : {
          error: {
            code: status === "cancelled" ? "cancelled" : "adb-failed",
            category: status === "cancelled" ? ("cancelled" as const) : ("infrastructure" as const),
            message: status === "cancelled" ? "cancelled" : "ADB failed",
            retryable: false,
          },
        }),
  };
}

async function files(
  testSource: string,
  target: Record<string, unknown> = {},
): Promise<{ root: string; configPath: string; testPath: string }> {
  const root = await mkdtemp(join(tmpdir(), "couch-runner-regression-"));
  const configPath = join(root, "couch.config.ts");
  const testPath = join(root, "case.tv.ts");
  await Bun.write(
    configPath,
    `export default ${JSON.stringify({
      configVersion: 1,
      targets: {
        lab: {
          deviceId: "android-1",
          app: { id: "com.example.app", activity: ".Main" },
          ...target,
        },
      },
    })}`,
  );
  await Bun.write(testPath, testSource);
  return { root, configPath, testPath };
}

function inventory(
  session: DeviceSession,
  overrides: Partial<DeviceInventory> = {},
): DeviceInventory {
  return {
    listDevices: async () => [],
    getDevice: async () => ({
      id: "android-1",
      name: "Lab",
      platform: "android-tv",
      ip: "192.0.2.1",
    }),
    getCapabilities: async () => new Map(kinds.map((kind) => [kind, ready])),
    openSession: async () => session,
    ...overrides,
  };
}

function currentArtifactDirectory(root: string): string | undefined {
  let current = root;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!existsSync(current)) return undefined;
    const child = readdirSync(current).find((name) => !name.startsWith("."));
    if (!child) return undefined;
    current = join(current, child);
  }
  return current;
}

describe("runner operation contracts", () => {
  test("rejects undeclared operations before driver execution", async () => {
    const paths = await files(
      `export default { name: "undeclared", requires: ["control.press"], async run({ tv }) { await tv.app.launch(); } }`,
    );
    const executed: DeviceOperation[] = [];
    const session: DeviceSession = {
      capabilities: new Map(),
      async execute(operation) {
        executed.push(operation);
        return record(operation, executed.length);
      },
      close: async () => undefined,
    };
    const outcome = await runTvTest({
      file: paths.testPath,
      targetAlias: "lab",
      inventory: inventory(session),
      configPath: paths.configPath,
      artifactDirectory: join(paths.root, "artifacts"),
    });
    expect(outcome.result).toMatchObject({ status: "infrastructure-failed", exitCode: 2 });
    expect(outcome.result.error?.message).toContain("undeclared operation: app.launch");
    expect(executed.map((operation) => operation.kind)).toEqual(["app.stop"]);
  });

  test("foreground timeout is an assertion failure with an assertion record", async () => {
    const paths = await files(
      `export default { name: "foreground", requires: ["app.foreground"], async run({ tv }) { await tv.app.foreground(); } }`,
      { foregroundTimeoutMs: 1 },
    );
    let ordinal = 0;
    const session: DeviceSession = {
      capabilities: new Map(),
      execute: async (operation) =>
        record(
          operation,
          ++ordinal,
          "succeeded",
          operation.kind === "app.foreground" ? { foreground: false } : undefined,
        ),
      close: async () => undefined,
    };
    const outcome = await runTvTest({
      file: paths.testPath,
      targetAlias: "lab",
      inventory: inventory(session),
      configPath: paths.configPath,
      artifactDirectory: join(paths.root, "artifacts"),
    });
    expect(outcome.result).toMatchObject({ status: "failed", exitCode: 1 });
    expect(outcome.result.assertions).toHaveLength(1);
    expect(outcome.result.assertions[0]).toMatchObject({
      matcher: "foreground",
      status: "failed",
    });
  });

  test("cleanup stop failure changes a pass to infrastructure failure", async () => {
    const paths = await files(`export default { name: "cleanup", requires: [], async run() {} }`, {
      cleanup: "stop",
    });
    let stops = 0;
    const session: DeviceSession = {
      capabilities: new Map(),
      async execute(operation) {
        stops += 1;
        return record(operation, stops, stops === 2 ? "failed" : "succeeded");
      },
      close: async () => undefined,
    };
    const outcome = await runTvTest({
      file: paths.testPath,
      targetAlias: "lab",
      inventory: inventory(session),
      configPath: paths.configPath,
      artifactDirectory: join(paths.root, "artifacts"),
    });
    expect(outcome.result).toMatchObject({
      status: "infrastructure-failed",
      exitCode: 2,
      cleanupError: { code: "adb-failed" },
    });
  });
});

describe("runner cancellation and lock reuse", () => {
  test.each([
    "launch",
    "foreground",
    "foreground-poll",
    "press",
    "capture",
    "cleanup",
    "close",
  ] as const)("cancels during %s and permits immediate reuse", async (phase) => {
    const source = {
      launch: `export default { name: "launch", requires: ["app.launch"], async run({ tv }) { await tv.app.launch(); } }`,
      foreground: `export default { name: "foreground", requires: ["app.foreground"], async run({ tv }) { await tv.app.foreground(); } }`,
      "foreground-poll": `export default { name: "foreground-poll", requires: ["app.foreground"], async run({ tv }) { await tv.app.foreground(); } }`,
      press: `export default { name: "press", requires: ["control.press"], async run({ tv }) { await tv.press("LEFT"); } }`,
      capture: `export default { name: "capture", requires: ["screen.capture"], async run({ tv }) { await tv.screen.capture(); } }`,
      cleanup: `export default { name: "cleanup", requires: [], async run() {} }`,
      close: `export default { name: "close", requires: [], async run() {} }`,
    }[phase];
    const paths = await files(source, phase === "cleanup" ? { cleanup: "stop" } : {});
    const controller = new AbortController();
    let locked = false;
    let ordinal = 0;
    let stopCount = 0;
    const shouldCancel = (operation: DeviceOperation) => {
      if (phase === "launch") return operation.kind === "app.launch";
      if (phase === "foreground") return operation.kind === "app.foreground";
      if (phase === "foreground-poll" && operation.kind === "app.foreground") {
        setTimeout(() => controller.abort(new Error("Interrupted")), 0);
        return false;
      }
      if (phase === "press") return operation.kind === "control.press";
      if (phase === "capture") return operation.kind === "screen.capture";
      if (phase === "cleanup" && operation.kind === "app.stop") return ++stopCount === 2;
      return false;
    };
    const session: DeviceSession = {
      capabilities: new Map(),
      async execute(operation) {
        if (shouldCancel(operation)) controller.abort(new Error("Interrupted"));
        return record(
          operation,
          ++ordinal,
          controller.signal.aborted ? "cancelled" : "succeeded",
          operation.kind === "app.foreground" ? { foreground: false } : undefined,
        );
      },
      async close() {
        if (phase === "close") controller.abort(new Error("Interrupted"));
        locked = false;
      },
    };
    const deviceInventory = inventory(session, {
      async openSession() {
        if (locked) throw new Error("device locked");
        locked = true;
        return session;
      },
    });
    const outcome = await runTvTest({
      file: paths.testPath,
      targetAlias: "lab",
      inventory: deviceInventory,
      signal: controller.signal,
      signalExitCode: () =>
        controller.signal.aborted ? (phase === "close" ? 143 : 130) : undefined,
      configPath: paths.configPath,
      artifactDirectory: join(paths.root, "artifacts"),
    });
    expect(outcome.result).toMatchObject({
      status: "cancelled",
      exitCode: phase === "close" ? 143 : 130,
    });
    const reused = await deviceInventory.openSession("android-1", { require: [] });
    await reused.close();
    expect(locked).toBe(false);
  });

  test("releases the canonical inventory lock for immediate reacquisition", async () => {
    const paths = await files(
      `export default { name: "real-lock", requires: ["app.launch"], async run({ tv }) { await tv.app.launch(); } }`,
    );
    const controller = new AbortController();
    const capabilities = new Map(kinds.map((kind) => [kind, ready]));
    const registry: NonNullable<DeviceInventoryOptions["registry"]> = {
      getRegistration: () => ({
        driverId: "adb",
        platform: "android-tv",
        lockResourceId: () => "adb:serial-1",
        getCapabilities: () => capabilities,
        createDriver: () => ({
          adapterId: "adb",
          open: async () => undefined,
          isReady: async () => true,
          async execute(operation) {
            if (operation.kind === "app.launch") {
              controller.abort(new Error("Interrupted"));
              throw controller.signal.reason;
            }
            return { confirmation: "process-exit" };
          },
          close: async () => undefined,
        }),
      }),
    };
    const deviceInventory = createDeviceInventory({
      inventoryLoader: async () => [
        { id: "android-1", name: "Lab", platform: "android-tv", ip: "192.0.2.1" },
      ],
      registry,
      lockDirectory: join(paths.root, "locks"),
      closeTimeoutMs: 100,
    });
    const outcome = await runTvTest({
      file: paths.testPath,
      targetAlias: "lab",
      inventory: deviceInventory,
      signal: controller.signal,
      signalExitCode: () => (controller.signal.aborted ? 130 : undefined),
      configPath: paths.configPath,
      artifactDirectory: join(paths.root, "artifacts"),
    });
    expect(outcome.result).toMatchObject({ status: "cancelled", exitCode: 130 });
    const reused = await deviceInventory.openSession("android-1", {
      require: ["control.press"],
    });
    await reused.close();
  });

  test("bounds a non-cooperative final close", async () => {
    const paths = await files(
      `export default { name: "bounded-close", requires: [], async run() {} }`,
      { cleanupTimeoutMs: 10 },
    );
    const session: DeviceSession = {
      capabilities: new Map(),
      execute: async (operation) => record(operation, 1),
      close: () => new Promise(() => undefined),
    };
    const started = performance.now();
    const outcome = await runTvTest({
      file: paths.testPath,
      targetAlias: "lab",
      inventory: inventory(session),
      configPath: paths.configPath,
      artifactDirectory: join(paths.root, "artifacts"),
    });
    expect(performance.now() - started).toBeLessThan(500);
    expect(outcome.result).toMatchObject({
      status: "infrastructure-failed",
      exitCode: 2,
      cleanupError: { code: "session-cleanup-failed" },
    });
  });

  test("retains the real lock until a timed-out close actually settles", async () => {
    const paths = await files(
      `export default { name: "retained-lock", requires: [], async run() {} }`,
      { cleanupTimeoutMs: 10 },
    );
    let settleClose = () => undefined;
    let firstDriver = true;
    const capabilities = new Map(kinds.map((kind) => [kind, ready]));
    const registry: NonNullable<DeviceInventoryOptions["registry"]> = {
      getRegistration: () => ({
        driverId: "adb",
        platform: "android-tv",
        lockResourceId: () => "adb:serial-retained",
        getCapabilities: () => capabilities,
        createDriver: () => {
          const waitsForSettlement = firstDriver;
          firstDriver = false;
          return {
            adapterId: "adb",
            open: async () => undefined,
            isReady: async () => true,
            execute: async () => ({ confirmation: "process-exit" }),
            close: waitsForSettlement
              ? () =>
                  new Promise<void>((resolveClose) => {
                    settleClose = resolveClose;
                  })
              : async () => undefined,
          };
        },
      }),
    };
    const deviceInventory = createDeviceInventory({
      inventoryLoader: async () => [
        { id: "android-1", name: "Lab", platform: "android-tv", ip: "192.0.2.1" },
      ],
      registry,
      lockDirectory: join(paths.root, "locks"),
      closeTimeoutMs: 1_000,
    });
    const outcome = await runTvTest({
      file: paths.testPath,
      targetAlias: "lab",
      inventory: deviceInventory,
      configPath: paths.configPath,
      artifactDirectory: join(paths.root, "artifacts"),
    });
    expect(outcome.result).toMatchObject({
      status: "infrastructure-failed",
      cleanupError: { code: "session-cleanup-failed" },
    });
    await expect(
      deviceInventory.openSession("android-1", { require: ["control.press"] }),
    ).rejects.toThrow("locked");
    settleClose();
    let reused: DeviceSession | undefined;
    for (let attempt = 0; attempt < 20 && !reused; attempt += 1) {
      reused = await deviceInventory
        .openSession("android-1", { require: ["control.press"] })
        .catch(() => undefined);
      if (!reused) await Bun.sleep(5);
    }
    expect(reused).toBeDefined();
    await reused?.close();
  });
});

describe("runner artifacts and schema", () => {
  test.each([
    ["SIGINT", 130, false],
    ["SIGTERM", 143, true],
  ] as const)("%s during publication wins in returned and persisted results", async (_signal, exitCode, failPublication) => {
    const paths = await files(
      `export default { name: "publication-cancel", requires: [], async run() {} }`,
    );
    const controller = new AbortController();
    const diagnostics: string[] = [];
    Object.defineProperty(diagnostics, "join", {
      value: () => {
        controller.abort(new Error(exitCode === 143 ? "Terminated" : "Interrupted"));
        if (failPublication) throw new Error("diagnostics publication failed");
        return "";
      },
    });
    const session: DeviceSession = {
      capabilities: new Map(),
      execute: async (operation) => record(operation, 1),
      close: async () => undefined,
    };
    const outcome = await runTvTest({
      file: paths.testPath,
      targetAlias: "lab",
      inventory: inventory(session),
      signal: controller.signal,
      signalExitCode: () => (controller.signal.aborted ? exitCode : undefined),
      diagnostics,
      configPath: paths.configPath,
      artifactDirectory: join(paths.root, "artifacts"),
    });
    expect(outcome.result).toMatchObject({ status: "cancelled", exitCode });
    const directory = outcome.artifactDirectory;
    if (!directory) throw new Error("Expected artifacts");
    expect(JSON.parse(await Bun.file(join(directory, "result.json")).text())).toMatchObject({
      status: "cancelled",
      exitCode,
    });
    expect((await readdir(directory)).some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  test.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)("%s after the first result write atomically replaces it", async (_signal, exitCode) => {
    const paths = await files(
      `export default { name: "result-publication-cancel", requires: [], async run() {} }`,
    );
    const artifactRoot = join(paths.root, "artifacts");
    const controller = new AbortController();
    const session: DeviceSession = {
      capabilities: new Map(),
      execute: async (operation) => record(operation, 1),
      close: async () => undefined,
    };
    const outcome = await runTvTest({
      file: paths.testPath,
      targetAlias: "lab",
      inventory: inventory(session),
      signal: controller.signal,
      signalExitCode: () => {
        const directory = currentArtifactDirectory(artifactRoot);
        if (!controller.signal.aborted && directory && existsSync(join(directory, "result.json"))) {
          controller.abort(new Error(exitCode === 143 ? "Terminated" : "Interrupted"));
        }
        return controller.signal.aborted ? exitCode : undefined;
      },
      configPath: paths.configPath,
      artifactDirectory: artifactRoot,
    });
    expect(outcome.result).toMatchObject({ status: "cancelled", exitCode });
    const directory = outcome.artifactDirectory;
    if (!directory) throw new Error("Expected artifacts");
    expect(JSON.parse(await Bun.file(join(directory, "result.json")).text())).toMatchObject({
      status: "cancelled",
      exitCode,
    });
    expect((await readdir(directory)).some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  test("final result publication failure keeps active cancellation precedence", async () => {
    const paths = await files(
      `export default { name: "result-publication-failure", requires: [], async run() {} }`,
    );
    const artifactRoot = join(paths.root, "artifacts");
    const controller = new AbortController();
    const diagnostics: string[] = [];
    Object.defineProperty(diagnostics, "join", {
      value: () => {
        const directory = currentArtifactDirectory(artifactRoot);
        if (!directory) throw new Error("Expected artifact directory");
        mkdirSync(join(directory, "result.json"));
        controller.abort(new Error("Interrupted"));
        return "";
      },
    });
    const session: DeviceSession = {
      capabilities: new Map(),
      execute: async (operation) => record(operation, 1),
      close: async () => undefined,
    };
    const outcome = await runTvTest({
      file: paths.testPath,
      targetAlias: "lab",
      inventory: inventory(session),
      signal: controller.signal,
      signalExitCode: () => (controller.signal.aborted ? 130 : undefined),
      diagnostics,
      configPath: paths.configPath,
      artifactDirectory: artifactRoot,
    });
    expect(outcome.result).toMatchObject({ status: "cancelled", exitCode: 130 });
    const directory = outcome.artifactDirectory;
    if (!directory) throw new Error("Expected artifacts");
    expect((await readdir(directory)).some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  test("contains dot-segment capture names and publishes allowlisted device metadata", async () => {
    const paths = await files(
      `export default { name: "paths", requires: ["screen.capture"], async run({ tv }) { await tv.screen.capture(".."); } }`,
    );
    let capturePath = "";
    let ordinal = 0;
    const session: DeviceSession = {
      capabilities: new Map(),
      async execute(operation) {
        if (operation.kind === "screen.capture") capturePath = operation.path ?? "";
        return record(operation, ++ordinal);
      },
      close: async () => undefined,
    };
    const outcome = await runTvTest({
      file: paths.testPath,
      targetAlias: "lab",
      inventory: inventory(session),
      configPath: paths.configPath,
      artifactDirectory: join(paths.root, "artifacts"),
    });
    const directory = outcome.artifactDirectory;
    if (!directory) throw new Error("Expected artifacts");
    expect(resolve(capturePath).startsWith(`${resolve(directory)}/`)).toBe(true);
    expect(basename(capturePath)).not.toBe("..");
    const metadata = JSON.parse(await Bun.file(join(directory, "device.json")).text());
    expect(metadata).toEqual({ id: "android-1", name: "Lab", platform: "android-tv" });
    expect(metadata.ip).toBeUndefined();
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(dirname(directory))).mode & 0o777).toBe(0o700);
    expect((await stat(dirname(dirname(directory)))).mode & 0o777).toBe(0o700);
  });

  test("rejects non-Android devices before capability probing", async () => {
    const paths = await files(`export default { name: "webos", requires: [], async run() {} }`);
    let probed = false;
    const session: DeviceSession = {
      capabilities: new Map(),
      execute: async (operation) => record(operation, 1),
      close: async () => undefined,
    };
    const outcome = await runTvTest({
      file: paths.testPath,
      targetAlias: "lab",
      inventory: inventory(session, {
        getDevice: async () => ({
          id: "android-1",
          name: "WebOS",
          platform: "webos",
          ip: "192.0.2.2",
        }),
        getCapabilities: async () => {
          probed = true;
          return new Map();
        },
      }),
      configPath: paths.configPath,
      artifactDirectory: join(paths.root, "artifacts"),
    });
    expect(outcome.result.exitCode).toBe(2);
    expect(probed).toBe(false);
  });

  test("validates result and trace shapes rather than JSON serializability", () => {
    expect(() =>
      validateTestResult({
        resultVersion: 1,
        status: "passed",
        exitCode: 2,
        assertions: [],
      }),
    ).toThrow("do not align");
    expect(() =>
      validateTestResult({
        resultVersion: 1,
        status: "failed",
        exitCode: 1,
        assertions: [
          { id: "a", matcher: "equal", status: "failed", operationIds: [1], artifacts: [] },
        ],
      }),
    ).toThrow("Invalid assertion schema");
    expect(() =>
      validateTestTrace({
        traceVersion: 1,
        runId: "run",
        targetId: "lab",
        startedAt: "invalid",
        completedAt: "invalid",
        operations: [],
        artifacts: [],
      }),
    ).toThrow("Invalid trace schema");
    expect(() =>
      validateTestTrace({
        traceVersion: 1,
        runId: "run",
        targetId: "lab",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        operations: [
          {
            id: "operation",
            ordinal: 1,
            kind: "control.press",
            adapterId: "adb",
            status: "succeeded",
            startedAt: "invalid",
            completedAt: "invalid",
            input: {},
            artifacts: [],
          },
        ],
        artifacts: [],
      }),
    ).toThrow("Invalid operation record schema");
  });
});
