import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  DeviceInventory,
  DeviceOperation,
  DeviceSession,
  OperationKind,
  OperationRecord,
} from "@couch/device";
import { MockLanguageModelV4 } from "ai/test";
import { runTvTest } from "./runner";

const mockUsage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

const SCREEN_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const SCREEN_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAAB//8AAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AACwgAAQABAQERAP/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//dAAQAAf/aAAgBAQAAPwD8A6//2Q==",
  "base64",
);

function screenQuestionModel(text: string) {
  return new MockLanguageModelV4({
    modelId: "mock-vision",
    doGenerate: {
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: mockUsage,
      warnings: [],
      response: { id: "response", timestamp: new Date(0), modelId: "mock-response-model" },
    },
  });
}

test("runs through one session and publishes canonical ordered records", async () => {
  const root = await mkdtemp(join(tmpdir(), "couch-runner-"));
  const configPath = join(root, "couch.config.ts");
  const testPath = join(root, "trace.tv.ts");
  await Bun.write(
    configPath,
    `export default { configVersion: 1, ai: { model: "unused/model" }, targets: { lab: { deviceId: "android-1", app: { id: "com.example.app", activity: ".Main" } } } };`,
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

test.each([
  [
    "awake",
    [true, false],
    [
      { kind: "app.foreground", appId: "com.example.app" },
      { kind: "control.press", key: "EXIT" },
      { kind: "app.foreground", appId: "com.example.app" },
      { kind: "app.launch", appId: "com.example.app" },
      { kind: "app.foreground", appId: "com.example.app" },
    ],
  ],
  [
    "standby",
    [true, true, false],
    [
      { kind: "app.foreground", appId: "com.example.app" },
      { kind: "control.press", key: "EXIT" },
      { kind: "app.foreground", appId: "com.example.app" },
      { kind: "control.press", key: "EXIT" },
      { kind: "app.foreground", appId: "com.example.app" },
      { kind: "app.launch", appId: "com.example.app" },
      { kind: "app.foreground", appId: "com.example.app" },
    ],
  ],
  [
    "another app",
    [false],
    [
      { kind: "app.foreground", appId: "com.example.app" },
      { kind: "app.launch", appId: "com.example.app" },
      { kind: "app.foreground", appId: "com.example.app" },
    ],
  ],
] as const)("resets an LG webOS app before launch when TV is %s", async (_, states, expected) => {
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
  let foregroundChecks = 0;
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
        ...(operation.kind === "app.foreground"
          ? { metadata: { foreground: states[foregroundChecks++] ?? true } }
          : {}),
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
      expect(options.require).toEqual(["app.foreground", "control.press", "app.launch"]);
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
  expect(executed).toEqual(expected);
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
      expect(options.require).toEqual([
        "app.stop",
        "app.foreground",
        "control.press",
        "app.launch",
      ]);
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
  expect(outcome.result).toMatchObject({
    status: "infrastructure-failed",
    exitCode: 2,
    error: { message: "app.stop is not offered by any driver for webos-1" },
  });
  expect(outcome.trace?.operations).toEqual([]);
});

test.each([
  [false, "infrastructure-failed", 0, undefined],
  [true, "passed", 2, undefined],
  [true, "infrastructure-failed", 1, "wrong.png"],
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
  if (status === "passed")
    expect(executed.find((operation) => operation.kind === "screen.capture")).toMatchObject({
      format: "jpg",
      path: expect.stringMatching(/\.jpg$/),
    });
});

test.each([
  ["android-tv", "png", "image/png", "detail", "passed", 0],
  ["webos", "jpg", "image/jpeg", "detail", "passed", 0],
  ["android-tv", "png", "image/png", "home", "failed", 1],
  ["android-tv", "png", "image/png", "invalid", "infrastructure-failed", 2],
  ["android-tv", "png", "image/png", "cancelled", "cancelled", 143],
] as const)("asks one schema-driven screen question on %s with %s result", async (platform, format, mediaType, answer, status, exitCode) => {
  const root = await mkdtemp(join(tmpdir(), "couch-runner-screen-question-"));
  const configPath = join(root, "couch.config.ts");
  const testPath = join(root, "ask.tv.ts");
  const aiImport = pathToFileURL(join(process.cwd(), "node_modules/ai/dist/index.js")).href;
  await Bun.write(
    configPath,
    `export default { configVersion: 1, ai: { model: "configured/model" }, targets: { lab: { deviceId: "tv", app: { id: "app" }${platform === "webos" ? ', allowExperimental: ["screen.capture"]' : ""} } } };`,
  );
  await Bun.write(
    testPath,
    `import { Output } from ${JSON.stringify(aiImport)}; export default { name: "ask", requires: ["screen.capture"], async run({ tv, expect }) { const answer = await tv.screen.ask({ question: "Which screen?", output: Output.choice({ options: ["home", "detail"] }) }); expect.equal(answer.output, "detail"); } };`,
  );
  const executed: DeviceOperation[] = [];
  const session: DeviceSession = {
    capabilities: new Map(),
    async execute(operation) {
      executed.push(operation);
      if (operation.kind === "screen.capture") {
        await Bun.write(operation.path, format === "png" ? SCREEN_PNG : SCREEN_JPEG);
      }
      return {
        id: crypto.randomUUID(),
        ordinal: executed.length,
        kind: operation.kind,
        adapterId: "mock",
        status: "succeeded",
        confirmation: "protocol-response",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        input: operation,
        artifacts:
          operation.kind === "screen.capture"
            ? [{ path: operation.path, type: "screen-capture", mimeType: mediaType }]
            : [],
      };
    },
    close: async () => undefined,
  };
  const inventory: DeviceInventory = {
    listDevices: async () => [],
    getDevice: async () => ({ id: "tv", name: "TV", platform, ip: "192.0.2.1" }),
    getCapabilities: async () => new Map(),
    openSession: async () => session,
  };

  const controller = new AbortController();
  const aiModel =
    answer === "cancelled"
      ? new MockLanguageModelV4({
          doGenerate: () => {
            controller.abort(new Error("terminated during screen question"));
            throw controller.signal.reason;
          },
        })
      : screenQuestionModel(
          answer === "invalid" ? "invalid provider response" : JSON.stringify({ result: answer }),
        );
  const outcome = await runTvTest({
    file: testPath,
    targetAlias: "lab",
    inventory,
    configPath,
    artifactDirectory: join(root, "artifacts"),
    aiModel,
    signal: controller.signal,
    signalExitCode: () => (answer === "cancelled" ? 143 : undefined),
  });

  expect(outcome.result).toMatchObject({ status, exitCode });
  const captures = executed.filter((operation) => operation.kind === "screen.capture");
  expect(captures).toHaveLength(1);
  expect(captures[0]).toMatchObject({ format, path: expect.stringContaining("screen-question-1") });
  expect(outcome.trace?.artifacts).toHaveLength(1);
});

test("screen questions fail before capture without a configured model", async () => {
  const root = await mkdtemp(join(tmpdir(), "couch-runner-screen-question-missing-"));
  const configPath = join(root, "couch.config.ts");
  const testPath = join(root, "ask.tv.ts");
  const aiImport = pathToFileURL(join(process.cwd(), "node_modules/ai/dist/index.js")).href;
  await Bun.write(
    configPath,
    `export default { configVersion: 1, targets: { lab: { deviceId: "tv", app: { id: "app" } } } };`,
  );
  await Bun.write(
    testPath,
    `import { Output } from ${JSON.stringify(aiImport)}; export default { name: "ask missing", requires: ["screen.capture"], async run({ tv }) { await tv.screen.ask({ question: "Which screen?", output: Output.choice({ options: ["home", "detail"] }) }); } };`,
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
        adapterId: "mock",
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
    getDevice: async () => ({ id: "tv", name: "TV", platform: "android-tv", ip: "192.0.2.1" }),
    getCapabilities: async () => new Map(),
    openSession: async () => session,
  };

  const outcome = await runTvTest({
    file: testPath,
    targetAlias: "lab",
    inventory,
    configPath,
    artifactDirectory: join(root, "artifacts"),
  });

  expect(outcome.result).toMatchObject({ status: "infrastructure-failed", exitCode: 2 });
  expect(executed.filter((operation) => operation.kind === "screen.capture")).toHaveLength(0);
});
