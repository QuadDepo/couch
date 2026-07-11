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
  const records: OperationRecord[] = [];
  let closed = 0;
  const session: DeviceSession = {
    capabilities: new Map(),
    async execute(operation: DeviceOperation) {
      const record: OperationRecord = {
        id: crypto.randomUUID(),
        ordinal: records.length + 1,
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
      records.push(record);
      return record;
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
  const inventory: DeviceInventory = {
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
    inventory,
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
