import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type {
  DeviceInventory,
  DeviceOperation,
  DeviceSession,
  OperationKind,
  OperationRecord,
} from "@couch/device";
import { runTvTest } from "./runner";

test("runs through one session and publishes canonical ordered records", async () => {
  const root = await mkdtemp(join(tmpdir(), "couch-runner-"));
  const configPath = join(root, "couch.config.ts");
  const testPath = join(root, "trace.tv.ts");
  await Bun.write(
    configPath,
    `export default { configVersion: 1, targets: { lab: { deviceId: "android-1", app: { id: "com.example.app", activity: ".Main" } } } };`,
  );
  await Bun.write(
    testPath,
    `export default { name: "tracer", requires: ["app.launch", "app.foreground", "control.press", "screen.capture"], async run({ tv, expect }) { await tv.app.launch(); const foreground = await tv.app.foreground(); expect.foreground(foreground); await tv.press("LEFT", { times: 3 }); await tv.screen.capture(); } };`,
  );
  const operationRecords: OperationRecord[] = [];
  let closed = 0;
  const session: DeviceSession = {
    capabilities: new Map(),
    async execute(operation: DeviceOperation) {
      const operationRecord: OperationRecord = {
        id: crypto.randomUUID(),
        ordinal: operationRecords.length + 1,
        kind: operation.kind,
        adapterId: "adb",
        status: "succeeded",
        confirmation: "process-exit",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        input: operation,
        artifacts: [],
        ...(operation.kind === "app.foreground" ? { metadata: { foreground: true } } : {}),
      };
      operationRecords.push(operationRecord);
      return operationRecord;
    },
    async close() {
      closed += 1;
    },
  };
  const ready = { support: "stable", readiness: "ready" } as const;
  const kinds: OperationKind[] = [
    "app.stop",
    "app.launch",
    "app.foreground",
    "control.press",
    "screen.capture",
  ];
  const inventoryStub: DeviceInventory = {
    listDevices: async () => [],
    getDevice: async () => ({
      id: "android-1",
      name: "Lab",
      platform: "android-tv",
      ip: "192.0.2.1",
    }),
    getCapabilities: async () => new Map(kinds.map((kind) => [kind, ready])),
    openSession: async () => session,
  };
  const outcome = await runTvTest({
    file: testPath,
    targetAlias: "lab",
    inventory: inventoryStub,
    configPath,
    artifactDirectory: join(root, "artifacts"),
  });
  expect(outcome.result.status).toBe("passed");
  expect(outcome.trace?.operations.map((record) => record.kind)).toEqual([
    "app.stop",
    "app.launch",
    "app.foreground",
    "control.press",
    "control.press",
    "control.press",
    "screen.capture",
  ]);
  expect(closed).toBe(1);
  const directory = outcome.artifactDirectory;
  expect(directory).toBeDefined();
  if (!directory) throw new Error("Expected artifact directory");
  expect(basename(directory)).toBe("tracer");
  expect(JSON.parse(await Bun.file(join(directory, "trace.json")).text()).traceVersion).toBe(1);
  expect(JSON.parse(await Bun.file(join(directory, "result.json")).text()).resultVersion).toBe(1);
});

test("runs the mandatory nonvisual LG webOS lifecycle path", async () => {
  const root = await mkdtemp(join(tmpdir(), "couch-runner-webos-"));
  const configPath = join(root, "couch.config.ts");
  const testPath = join(root, "launch.tv.ts");
  await Bun.write(
    configPath,
    `export default { configVersion: 1, targets: { webos: { deviceId: "webos-1", app: { id: "com.example.app" }, cleanup: "leave-running" } } };`,
  );
  await Bun.write(
    testPath,
    `export default { name: "webos launch", requires: ["app.launch", "app.foreground"], async run({ tv, expect }) { await tv.app.launch(); expect.foreground(await tv.app.foreground()); } };`,
  );
  const executed: DeviceOperation[] = [];
  const session: DeviceSession = {
    capabilities: new Map(),
    async execute(operation) {
      executed.push(operation);
      return {
        id: crypto.randomUUID(),
        ordinal: executed.length,
        kind: operation.kind,
        adapterId: "lg-ssap",
        status: "succeeded",
        confirmation: "protocol-response",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        input: operation,
        artifacts: [],
        ...(operation.kind === "app.foreground" ? { metadata: { foreground: true } } : {}),
      };
    },
    close: async () => undefined,
  };
  const inventory: DeviceInventory = {
    listDevices: async () => [],
    getDevice: async () => ({
      id: "webos-1",
      name: "LG Lab",
      platform: "webos",
      ip: "192.0.2.20",
      driverId: "lg-ssap",
    }),
    getCapabilities: async () => new Map(),
    openSession: async (_id, options) => {
      expect(options.require).toEqual(["app.launch", "app.foreground"]);
      return session;
    },
  };

  const outcome = await runTvTest({
    file: testPath,
    targetAlias: "webos",
    inventory,
    configPath,
    artifactDirectory: join(root, "artifacts"),
  });

  expect(outcome.result.status).toBe("passed");
  expect(executed.map((operation) => operation.kind)).toEqual(["app.launch", "app.foreground"]);
  expect(executed[0]).toEqual({ kind: "app.launch", appId: "com.example.app" });
});

test("rejects unsupported webOS stop cleanup during preflight", async () => {
  const root = await mkdtemp(join(tmpdir(), "couch-runner-webos-cleanup-"));
  const configPath = join(root, "couch.config.ts");
  const testPath = join(root, "launch.tv.ts");
  await Bun.write(
    configPath,
    `export default { configVersion: 1, targets: { webos: { deviceId: "webos-1", app: { id: "app" }, cleanup: "stop" } } };`,
  );
  await Bun.write(
    testPath,
    `export default { name: "cleanup preflight", requires: ["app.launch"], run() { throw new Error("must not run"); } };`,
  );
  let opened = false;
  const inventory: DeviceInventory = {
    listDevices: async () => [],
    getDevice: async () => ({ id: "webos-1", name: "LG", platform: "webos", ip: "192.0.2.20" }),
    getCapabilities: async () => new Map(),
    openSession: async (_id, options) => {
      opened = true;
      expect(options.require).toEqual(["app.stop", "app.launch"]);
      throw new Error("app.stop is not offered by any driver for webos-1");
    },
  };

  const outcome = await runTvTest({
    file: testPath,
    targetAlias: "webos",
    inventory,
    configPath,
    artifactDirectory: join(root, "artifacts"),
  });

  expect(opened).toBe(true);
  expect(outcome.result).toMatchObject({ status: "infrastructure-failed", exitCode: 2 });
  expect(outcome.trace?.operations).toEqual([]);
});

test.each([
  [false, "infrastructure-failed", 0, undefined],
  [true, "passed", 1, undefined],
  [true, "infrastructure-failed", 0, "wrong.png"],
] as const)("webOS capture approval=%s name=%s", async (allowed, status, count, name) => {
  const root = await mkdtemp(join(tmpdir(), "couch-runner-webos-capture-"));
  const configPath = join(root, "couch.config.ts");
  const testPath = join(root, "capture.tv.ts");
  await Bun.write(
    configPath,
    `export default { configVersion: 1, targets: { webos: { deviceId: "webos-1", app: { id: "app" }${allowed ? ', allowExperimental: ["screen.capture"]' : ""} } } };`,
  );
  await Bun.write(
    testPath,
    `export default { name: "capture gate", requires: ["screen.capture"], async run({ tv }) { await tv.screen.capture(${name ? JSON.stringify(name) : ""}); } };`,
  );
  const executed: DeviceOperation[] = [];
  const session: DeviceSession = {
    capabilities: new Map(),
    execute: async (operation) => {
      executed.push(operation);
      return {
        id: "capture",
        ordinal: 1,
        kind: operation.kind,
        adapterId: "lg-ssap",
        status: "succeeded",
        confirmation: "protocol-response",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        input: operation,
        artifacts: [],
      };
    },
    close: async () => undefined,
  };
  const inventory: DeviceInventory = {
    listDevices: async () => [],
    getDevice: async () => ({ id: "webos-1", name: "LG", platform: "webos", ip: "192.0.2.20" }),
    getCapabilities: async () => new Map(),
    openSession: async (_id, options) => {
      if (!options.allowExperimental?.includes("screen.capture")) {
        throw new Error("screen.capture requires explicit target approval");
      }
      return session;
    },
  };

  const outcome = await runTvTest({
    file: testPath,
    targetAlias: "webos",
    inventory,
    configPath,
    artifactDirectory: join(root, "artifacts"),
  });

  expect(outcome.result.status).toBe(status);
  expect(executed).toHaveLength(count);
  if (count)
    expect(executed[0]).toMatchObject({
      format: "jpg",
      path: expect.stringMatching(/\.jpg$/),
    });
});
