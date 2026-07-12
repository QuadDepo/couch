import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  DeviceInventory,
  DeviceOperation,
  DeviceSession,
  OperationRecord,
} from "@couch/device";
import type { RunTvTestOptions } from "@couch/runner/runner";
import { runTvTest as actualRunTvTest } from "@couch/runner/runner";
import { MockLanguageModelV4 } from "ai/test";
import { runCli } from "./cli";
import { output } from "./testSupport/fakes";

const screen = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const agentModel = new MockLanguageModelV4({
  modelId: "mock-navigation",
  doGenerate: {
    content: [
      {
        type: "tool-call",
        toolCallId: "finish-1",
        toolName: "finish",
        input: JSON.stringify({
          status: "completed",
          reason: "Home screen is visible",
          decision: "Finish because the goal is visibly complete",
        }),
      },
    ],
    finishReason: { unified: "tool-calls", raw: "tool-calls" },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
    response: { id: "response", timestamp: new Date(0), modelId: "mock-navigation" },
  },
});

describe("CLI dispatch", () => {
  test("returns stable help", async () => {
    const result = output();
    expect(await runCli(["--help"], { stdout: result.writeOut, stderr: result.writeErr })).toBe(0);
    expect(result.stdout[0]).toContain("couch device list");
    expect(result.stdout[0]).toContain("couch remote press");
  });

  test("returns usage errors without creating an inventory", async () => {
    const result = output();
    let created = false;
    const exit = await runCli(["remote", "press", "lab", "NOPE"], {
      createInventory: () => {
        created = true;
        throw new Error("unreachable");
      },
      stdout: result.writeOut,
      stderr: result.writeErr,
    });
    expect(exit).toBe(64);
    expect(created).toBe(false);
    expect(result.stdout).toEqual([]);
    expect(result.stderr[0]).toContain("unknown remote key");
  });

  test("streams test events only for human output", async () => {
    const human = output();
    const runTvTest = async (options: RunTvTestOptions) => {
      options.onEvent?.({
        type: "run-start",
        runId: "run-1",
        targetAlias: options.targetAlias,
        file: options.file,
        at: "2026-01-01T00:00:00.000Z",
      });
      options.onEvent?.({
        type: "assertion",
        assertion: { id: "a", matcher: "equal", status: "passed" },
        at: "2026-01-01T00:00:00.100Z",
      });
      return {
        result: {
          resultVersion: 1 as const,
          status: "passed" as const,
          exitCode: 0 as const,
          assertions: [],
        },
      };
    };
    await runCli(["test", "smoke.tv.ts", "--target", "lab"], {
      runTvTest,
      stdout: human.writeOut,
      stderr: human.writeErr,
    });
    expect(human.stderr.join("")).toContain("test lab smoke.tv.ts\n  assertion: equal → passed\n");

    const json = output();
    await runCli(["test", "smoke.tv.ts", "--target", "lab", "--json"], {
      runTvTest,
      stdout: json.writeOut,
      stderr: json.writeErr,
    });
    expect(json.stdout).toHaveLength(1);
    expect(json.stderr.join("")).not.toContain("assertion equal");
  });

  test("streams real runner progress before it settles and isolates JSON output", async () => {
    const root = await mkdtemp(join(tmpdir(), "couch-cli-test-"));
    const file = join(root, "smoke.tv.ts");
    const configPath = join(root, "couch.config.ts");
    await Bun.write(
      configPath,
      `export default { configVersion: 1, targets: { lab: { deviceId: "fake-tv", app: { id: "com.example.app" }, cleanup: "leave-running", artifactDirectory: ${JSON.stringify(join(root, "artifacts"))} } } };`,
    );
    await Bun.write(
      file,
      `export default { name: "smoke", requires: ["app.launch", "app.foreground", "screen.capture"], async run({ tv, expect }) { const foreground = await tv.app.foreground(); expect.foreground(foreground); expect.equal("home", "home", "Home screen is ready"); await tv.agent.run("Confirm the home screen is ready"); } };`,
    );

    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const session: DeviceSession = {
      capabilities: new Map(),
      async execute(operation: DeviceOperation): Promise<OperationRecord> {
        if (calls++ === 0) await blocked;
        if (operation.kind === "screen.capture" && operation.path) {
          await Bun.write(operation.path, screen);
        }
        return {
          id: `operation-${calls}`,
          ordinal: calls,
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
      },
      async close() {},
    };
    const inventory: DeviceInventory = {
      listDevices: async () => [],
      getDevice: async () => ({
        id: "fake-tv",
        name: "Fake TV",
        platform: "android-tv",
        ip: "192.0.2.1",
      }),
      getCapabilities: async () => new Map(),
      openSession: async () => session,
    };
    const runTvTest = (options: RunTvTestOptions) =>
      actualRunTvTest({
        ...options,
        configPath,
        artifactDirectory: join(root, "artifacts"),
        aiModel: agentModel,
      });

    const human = output();
    let settled = false;
    const pending = runCli(["test", file, "--target", "lab"], {
      createInventory: async () => inventory,
      runTvTest,
      stdout: human.writeOut,
      stderr: human.writeErr,
    }).then((code) => {
      settled = true;
      return code;
    });
    expect(settled).toBe(false);
    expect(human.stderr.join("")).toContain(`test lab ${file}\n`);
    release();
    expect(await pending).toBe(0);
    const progress = human.stderr.join("");
    expect(progress).toContain("assertion: Home screen is ready → passed");
    expect(progress).toContain("decision: finish → Finish because the goal is visibly complete");
    expect(progress).toContain("tool: finish");

    const json = output();
    expect(
      await runCli(["test", file, "--target", "lab", "--json"], {
        createInventory: async () => inventory,
        runTvTest,
        stdout: json.writeOut,
        stderr: json.writeErr,
      }),
    ).toBe(0);
    expect(json.stdout).toHaveLength(1);
    const jsonLine = json.stdout[0];
    if (!jsonLine) throw new Error("Expected one JSON result");
    expect(JSON.parse(jsonLine).status).toBe("passed");
    expect(json.stderr.join("")).not.toContain("action:");
  });
});
