import { expect, test } from "bun:test";
import type { DeviceOperation, OperationRecord } from "@couch/device";
import { MockLanguageModelV4 } from "ai/test";
import {
  type NavigationFrame,
  type NavigationRunArtifact,
  runNavigationAgent,
} from "./navigationAgent";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const images = {
  "image/png": Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
  "image/jpeg": Buffer.from(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8Q/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=",
    "base64",
  ),
} as const;

function response(toolName: string, input: unknown) {
  const toolInput =
    input && typeof input === "object" ? { decision: `Use ${toolName}`, ...input } : input;
  return {
    content: [
      {
        type: "tool-call" as const,
        toolCallId: crypto.randomUUID(),
        toolName,
        input: JSON.stringify(toolInput),
      },
    ],
    finishReason: { unified: "tool-calls" as const, raw: "tool-calls" },
    usage,
    warnings: [],
    response: { modelId: "mock-navigation" },
  };
}

function stopped(raw = "STOP") {
  return {
    content: [{ type: "text" as const, text: "" }],
    finishReason: { unified: "stop" as const, raw },
    usage,
    warnings: [],
    response: { modelId: "mock-navigation" },
  };
}

function record(operation: DeviceOperation, ordinal: number): OperationRecord {
  return {
    id: `operation-${ordinal}`,
    ordinal,
    kind: operation.kind,
    adapterId: "test",
    status: "succeeded",
    startedAt: new Date(0).toISOString(),
    completedAt: new Date(0).toISOString(),
    input: operation,
    artifacts: [],
  };
}

test.each([
  "image/png",
  "image/jpeg",
] as const)("feeds %s action screenshots into the next model step", async (mediaType) => {
  let call = 0;
  const model = new MockLanguageModelV4({
    modelId: "mock-navigation",
    doGenerate: () => {
      call += 1;
      if (call === 1) {
        return response("press", {
          key: "RIGHT",
          expectedVisibleChange: "Focus moves right",
        });
      }
      return call === 2
        ? response("assess", { outcome: "achieved", evidence: "Focus moved right" })
        : response("finish", { status: "completed", reason: "Goal is visible" });
    },
  });
  const operations: DeviceOperation[] = [];
  let captures = 0;
  const capture = async (): Promise<NavigationFrame> => {
    captures += 1;
    const operation = {
      kind: "screen.capture",
      format: mediaType === "image/png" ? "png" : "jpg",
    } as const;
    return { record: record(operation, 100 + captures), bytes: images[mediaType], mediaType };
  };

  const result = await runNavigationAgent(
    {
      model,
      timeoutMs: 1_000,
      settleMs: 0,
      settle: async () => undefined,
      capture,
      execute: async (operation) => {
        operations.push(operation);
        return record(operation, operations.length);
      },
    },
    { goal: "Move right", maxSteps: 4 },
  );

  expect(result.status).toBe("completed");
  expect(operations).toEqual([{ kind: "control.press", key: "RIGHT" }]);
  expect(model.doGenerateCalls[0]).toMatchObject({
    reasoning: "low",
    maxOutputTokens: 1_024,
  });
  const secondPrompt = model.doGenerateCalls[1]?.prompt;
  expect(secondPrompt?.at(-1)).toMatchObject({
    role: "tool",
    content: [
      expect.objectContaining({
        output: expect.objectContaining({
          type: "content",
          value: expect.arrayContaining([expect.objectContaining({ type: "file", mediaType })]),
        }),
      }),
    ],
  });
});

test("returns blocked separately from test assertions", async () => {
  const model = new MockLanguageModelV4({
    modelId: "mock-navigation",
    doGenerate: response("finish", { status: "blocked", reason: "Target is unavailable" }),
  });
  const captureOperation = { kind: "screen.capture", format: "png" } as const;
  const result = await runNavigationAgent(
    {
      model,
      timeoutMs: 1_000,
      capture: async () => ({
        record: record(captureOperation, 1),
        bytes: images["image/png"],
        mediaType: "image/png",
      }),
      execute: async (operation) => record(operation, 2),
    },
    { goal: "Find Batman" },
  );

  expect(result).toMatchObject({ status: "blocked", reason: "Target is unavailable" });
});

test("blocks after three unchanged fresh screenshots", async () => {
  const model = new MockLanguageModelV4({
    modelId: "mock-navigation",
    doGenerate: response("observe", {}),
  });
  let captures = 0;
  const captureOperation = { kind: "screen.capture", format: "png" } as const;
  const result = await runNavigationAgent(
    {
      model,
      timeoutMs: 1_000,
      capture: async () => ({
        record: record(captureOperation, ++captures),
        bytes: images["image/png"],
        mediaType: "image/png",
      }),
      execute: async (operation) => record(operation, 10),
    },
    { goal: "Wait for a target", maxSteps: 10 },
  );

  expect(result.status).toBe("blocked");
  expect(captures).toBe(4);
});

test("preserves normal model termination without calling it a step limit", async () => {
  let modelCalls = 0;
  let artifact: unknown;
  const model = new MockLanguageModelV4({
    modelId: "mock-navigation",
    doGenerate: () => (++modelCalls === 1 ? response("observe", {}) : stopped()),
  });
  let captures = 0;
  const captureOperation = { kind: "screen.capture", format: "png" } as const;
  const result = await runNavigationAgent(
    {
      model,
      timeoutMs: 1_000,
      capture: async () => ({
        record: record(captureOperation, ++captures),
        bytes: captures === 1 ? images["image/png"] : Buffer.from(images["image/png"]),
        mediaType: "image/png",
      }),
      execute: async (operation) => record(operation, 10),
      publishArtifact: async (value) => {
        artifact = value;
      },
    },
    { goal: "Wait for home", maxSteps: 20 },
  );

  expect(result.status).toBe("failed");
  expect(artifact).toMatchObject({ stepCount: 2, terminationReason: "model-stop" });
});

test("rejects a multi-tool response before either mutation executes", async () => {
  const model = new MockLanguageModelV4({
    modelId: "mock-navigation",
    doGenerate: {
      ...response("press", { key: "RIGHT" }),
      content: [
        ...response("press", {
          key: "RIGHT",
          expectedVisibleChange: "Focus moves right",
        }).content,
        ...response("type", {
          text: "Batman",
          expectedVisibleChange: "Batman appears in the search field",
        }).content,
      ],
    },
  });
  const operations: DeviceOperation[] = [];
  const captureOperation = { kind: "screen.capture", format: "png" } as const;
  await expect(
    runNavigationAgent(
      {
        model,
        timeoutMs: 1_000,
        capture: async () => ({
          record: record(captureOperation, 1),
          bytes: images["image/png"],
          mediaType: "image/png",
        }),
        execute: async (operation) => {
          operations.push(operation);
          return record(operation, operations.length + 1);
        },
      },
      { goal: "Search", maxSteps: 20 },
    ),
  ).rejects.toThrow("multiple tool calls");
  expect(operations).toHaveLength(0);
});

test("cannot complete from evidence made stale by a batched mutation", async () => {
  const model = new MockLanguageModelV4({
    modelId: "mock-navigation",
    doGenerate: {
      ...response("press", { key: "RIGHT" }),
      content: [
        ...response("press", {
          key: "RIGHT",
          expectedVisibleChange: "Focus moves right",
        }).content,
        ...response("finish", { status: "completed", reason: "Assumed success" }).content,
      ],
    },
  });
  const operations: DeviceOperation[] = [];
  await expect(
    runNavigationAgent(
      {
        model,
        timeoutMs: 1_000,
        capture: async () => ({
          record: record({ kind: "screen.capture", format: "png" }, 1),
          bytes: images["image/png"],
          mediaType: "image/png",
        }),
        execute: async (operation) => {
          operations.push(operation);
          return record(operation, 2);
        },
      },
      { goal: "Move and finish" },
    ),
  ).rejects.toThrow("multiple tool calls");
  expect(operations).toHaveLength(0);
});

test("records sanitized step, tool, capture, usage, and readable log data", async () => {
  let modelCalls = 0;
  let captures = 0;
  let artifact: NavigationRunArtifact | undefined;
  let log = "";
  const model = new MockLanguageModelV4({
    modelId: "mock-navigation",
    doGenerate: () => {
      modelCalls += 1;
      if (modelCalls === 1) {
        return response("type", {
          text: "Batman",
          expectedVisibleChange: "Batman appears in the search field",
        });
      }
      return modelCalls === 2
        ? response("assess", {
            outcome: "achieved",
            evidence: "Search field shows the entered title",
          })
        : response("finish", { status: "completed", reason: "Search text is visible" });
    },
  });
  const captureOperation = { kind: "screen.capture", format: "png" } as const;
  await runNavigationAgent(
    {
      model,
      timeoutMs: 1_000,
      settleMs: 7,
      settle: async () => undefined,
      capture: async () => {
        const bytes = Buffer.from(images["image/png"]);
        bytes[bytes.length - 1] = ++captures;
        const captureRecord = record(captureOperation, captures);
        captureRecord.artifacts.push({ path: `/tmp/frame-${captures}.png`, type: "screenshot" });
        return { record: captureRecord, bytes, mediaType: "image/png" };
      },
      execute: async (operation) => record(operation, 10),
      publishArtifact: async (value) => {
        artifact = value;
      },
      publishLog: async (value) => {
        log = value;
      },
    },
    { goal: "Enter a title", maxSteps: 4 },
  );

  expect(artifact).toMatchObject({
    schemaVersion: 1,
    status: "completed",
    terminationReason: "completed",
    stepCount: 3,
    mutationCount: 1,
    observationCount: 0,
  });
  expect(artifact?.steps[0]).toMatchObject({
    toolCalls: [
      expect.objectContaining({
        name: "type",
        input: expect.objectContaining({ length: 6, value: "[redacted]" }),
      }),
    ],
  });
  expect(artifact?.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "initial-capture",
        capture: expect.objectContaining({ mediaType: "image/png" }),
      }),
      expect.objectContaining({
        type: "tool-result",
        toolName: "type",
        settleMs: 7,
        capture: expect.objectContaining({
          path: "/tmp/frame-2.png",
          byteLength: images["image/png"].length,
        }),
        transition: expect.objectContaining({
          expectedVisibleChange: "[redacted] appears in the search field",
          beforeCaptureOrdinal: 1,
          afterCaptureOrdinal: 2,
          retryCount: 0,
        }),
      }),
      expect.objectContaining({
        type: "tool-result",
        toolName: "assess",
        transition: expect.objectContaining({
          assessment: "achieved",
          evidence: "Search field shows the entered title",
        }),
      }),
      expect.objectContaining({ type: "termination", terminationReason: "completed" }),
    ]),
  );
  expect(JSON.stringify(artifact)).not.toContain("Batman");
  expect(log).toContain("TOOL type");
  expect(log).toContain("attempts=1 recovered=false");
  expect(log).toContain('"assessment":"achieved"');
  expect(log).not.toContain("Batman");
});

test("distinguishes a true model step limit from mutation count", async () => {
  let captures = 0;
  const model = new MockLanguageModelV4({
    modelId: "mock-navigation",
    doGenerate: response("observe", {}),
  });
  const result = await runNavigationAgent(
    {
      model,
      timeoutMs: 1_000,
      capture: async () => {
        const bytes = Buffer.from(images["image/png"]);
        bytes[bytes.length - 1] = ++captures;
        return {
          record: record({ kind: "screen.capture", format: "png" }, captures),
          bytes,
          mediaType: "image/png",
        };
      },
      execute: async (operation) => record(operation, 20),
    },
    { goal: "Wait", maxSteps: 2 },
  );

  expect(result.terminationReason).toBe("step-limit");
  expect(model.doGenerateCalls).toHaveLength(2);
});

test("rejects stale capture ordinals and persists capture-stage failure", async () => {
  let captures = 0;
  let artifact: NavigationRunArtifact | undefined;
  const model = new MockLanguageModelV4({
    modelId: "mock-navigation",
    doGenerate: response("observe", {}),
  });
  await expect(
    runNavigationAgent(
      {
        model,
        timeoutMs: 1_000,
        settleMs: 0,
        capture: async () => ({
          record: record({ kind: "screen.capture", format: "png" }, ++captures === 1 ? 2 : 1),
          bytes: images["image/png"],
          mediaType: "image/png",
        }),
        execute: async (operation) => record(operation, 20),
        publishArtifact: async (value) => {
          artifact = value;
        },
      },
      { goal: "Observe", maxSteps: 4 },
    ),
  ).rejects.toThrow("not newer");
  expect(artifact).toMatchObject({
    status: "failed",
    terminationReason: "stale-capture",
    error: { stage: "capture" },
  });
});

test("rejects control characters before text reaches the device", async () => {
  const operations: DeviceOperation[] = [];
  const model = new MockLanguageModelV4({
    modelId: "mock-navigation",
    doGenerate: response("type", {
      text: "Bat\u0000man",
      expectedVisibleChange: "Text appears",
    }),
  });
  await expect(
    runNavigationAgent(
      {
        model,
        timeoutMs: 1_000,
        capture: async () => ({
          record: record({ kind: "screen.capture", format: "png" }, 1),
          bytes: images["image/png"],
          mediaType: "image/png",
        }),
        execute: async (operation) => {
          operations.push(operation);
          return record(operation, 2);
        },
      },
      { goal: "Type", maxSteps: 4 },
    ),
  ).rejects.toThrow("control characters");
  expect(operations).toHaveLength(0);
});

test.each([
  ["provider failure", "provider-error", () => new Error("secret provider detail")],
  ["capture failure", "capture-error", () => new Error("secret capture detail")],
] as const)("persists sanitized %s diagnostics", async (_name, terminationReason, failure) => {
  let artifact: NavigationRunArtifact | undefined;
  const model = new MockLanguageModelV4({
    modelId: "mock-navigation",
    doGenerate: () => {
      if (terminationReason === "provider-error") throw failure();
      return stopped();
    },
  });
  await expect(
    runNavigationAgent(
      {
        model,
        timeoutMs: 1_000,
        settleMs: 0,
        capture: async () => {
          if (terminationReason === "capture-error") throw failure();
          return {
            record: record({ kind: "screen.capture", format: "png" }, 1),
            bytes: images["image/png"],
            mediaType: "image/png",
          };
        },
        execute: async (operation) => record(operation, 2),
        publishArtifact: async (value) => {
          artifact = value;
        },
      },
      { goal: "Navigate" },
    ),
  ).rejects.toThrow();
  expect(artifact).toMatchObject({ status: "failed", terminationReason });
  expect(JSON.stringify(artifact)).not.toContain("secret");
});

test("persists cancellation without capturing or calling the model", async () => {
  const controller = new AbortController();
  controller.abort(new Error("Interrupted"));
  let artifact: NavigationRunArtifact | undefined;
  let captures = 0;
  const model = new MockLanguageModelV4({ modelId: "mock-navigation", doGenerate: stopped() });
  await expect(
    runNavigationAgent(
      {
        model,
        signal: controller.signal,
        timeoutMs: 1_000,
        capture: async () => {
          captures += 1;
          return {
            record: record({ kind: "screen.capture", format: "png" }, 1),
            bytes: images["image/png"],
            mediaType: "image/png",
          };
        },
        execute: async (operation) => record(operation, 2),
        publishArtifact: async (value) => {
          artifact = value;
        },
      },
      { goal: "Navigate" },
    ),
  ).rejects.toThrow("Interrupted");
  expect(captures).toBe(0);
  expect(artifact).toMatchObject({ status: "cancelled", terminationReason: "cancelled" });
  expect(model.doGenerateCalls).toHaveLength(0);
});

test("rejects failed operation records and redacts secrets from artifacts", async () => {
  let artifact: NavigationRunArtifact | undefined;
  let call = 0;
  const model = new MockLanguageModelV4({
    modelId: "mock-navigation",
    doGenerate: () =>
      ++call === 1
        ? response("press", {
            key: "RIGHT",
            expectedVisibleChange: "Focus moves right",
          })
        : response("finish", { status: "blocked", reason: "token=provider-secret" }),
  });
  await expect(
    runNavigationAgent(
      {
        model,
        timeoutMs: 1_000,
        capture: async () => ({
          record: record({ kind: "screen.capture", format: "png" }, 1),
          bytes: images["image/png"],
          mediaType: "image/png",
        }),
        execute: async (operation) => ({
          ...record(operation, 2),
          status: "failed",
        }),
        publishArtifact: async (value) => {
          artifact = value;
        },
      },
      { goal: "Use password=hunter2 to navigate" },
    ),
  ).rejects.toThrow("press failed");
  expect(JSON.stringify(artifact)).not.toContain("hunter2");
  expect(JSON.stringify(artifact)).not.toContain("provider-secret");
  expect(artifact).toMatchObject({ terminationReason: "device-error" });
});

test("denies retry when the action screenshot visibly changed", async () => {
  const replies = [
    response("press", { key: "BACK", expectedVisibleChange: "The previous screen appears" }),
    response("assess", { outcome: "no-change", evidence: "The goal was not reached" }),
    response("press", { key: "LEFT", expectedVisibleChange: "Focus moves left" }),
    response("assess", { outcome: "achieved", evidence: "Focus moved left" }),
    response("finish", { status: "completed", reason: "Focus is on the target" }),
  ];
  const model = new MockLanguageModelV4({
    modelId: "mock-navigation",
    doGenerate: () => replies.shift() ?? stopped(),
  });
  const operations: DeviceOperation[] = [];
  let captures = 0;
  let artifact: NavigationRunArtifact | undefined;
  let log = "";
  const result = await runNavigationAgent(
    {
      model,
      timeoutMs: 1_000,
      settleMs: 0,
      settle: async () => undefined,
      capture: async () => {
        const bytes = Buffer.from(images["image/png"]);
        bytes[bytes.length - 1] = ++captures;
        return {
          record: record({ kind: "screen.capture", format: "png" }, captures),
          bytes,
          mediaType: "image/png",
        };
      },
      execute: async (operation) => {
        operations.push(operation);
        return record(operation, 100 + operations.length);
      },
      publishArtifact: async (value) => {
        artifact = value;
      },
      publishLog: async (value) => {
        log = value;
      },
    },
    { goal: "Go back and move left", maxSteps: 8 },
  );

  expect(result.status).toBe("completed");
  expect(operations).toEqual([
    { kind: "control.press", key: "BACK" },
    { kind: "control.press", key: "LEFT" },
  ]);
  expect(artifact?.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        toolName: "assess",
        transition: expect.objectContaining({ retryDecision: "denied-screen-changed" }),
      }),
    ]),
  );
  expect(log).toContain('"retryDecision":"denied-screen-changed"');
});

test("denies retry when the confirming observation visibly changed", async () => {
  const replies = [
    response("press", { key: "BACK", expectedVisibleChange: "The previous screen appears" }),
    response("assess", { outcome: "no-change", evidence: "The screen stayed put" }),
    response("observe", {}),
    response("press", { key: "LEFT", expectedVisibleChange: "Focus moves left" }),
    response("assess", { outcome: "achieved", evidence: "Focus moved left" }),
    response("finish", { status: "completed", reason: "Focus is on the target" }),
  ];
  const model = new MockLanguageModelV4({
    modelId: "mock-navigation",
    doGenerate: () => replies.shift() ?? stopped(),
  });
  const operations: DeviceOperation[] = [];
  let captures = 0;
  let artifact: NavigationRunArtifact | undefined;
  const result = await runNavigationAgent(
    {
      model,
      timeoutMs: 1_000,
      settleMs: 0,
      settle: async () => undefined,
      capture: async () => {
        captures += 1;
        const bytes = Buffer.from(images["image/png"]);
        bytes[bytes.length - 1] = captures < 3 ? 1 : captures;
        return {
          record: record({ kind: "screen.capture", format: "png" }, captures),
          bytes,
          mediaType: "image/png",
        };
      },
      execute: async (operation) => {
        operations.push(operation);
        return record(operation, 100 + operations.length);
      },
      publishArtifact: async (value) => {
        artifact = value;
      },
    },
    { goal: "Go back and move left", maxSteps: 8 },
  );

  expect(result.status).toBe("completed");
  expect(operations).toEqual([
    { kind: "control.press", key: "BACK" },
    { kind: "control.press", key: "LEFT" },
  ]);
  expect(artifact?.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        toolName: "observe",
        transition: expect.objectContaining({ retryDecision: "denied-screen-changed" }),
      }),
    ]),
  );
});

test("retries the runner-stored action after two identical confirmations", async () => {
  const expectedVisibleChange = "Focus moves right";
  const replies = [
    response("press", { key: "RIGHT", expectedVisibleChange }),
    response("assess", { outcome: "no-change", evidence: "Focus stayed put" }),
    response("observe", {}),
    response("assess", { outcome: "no-change", evidence: "Focus still stayed put" }),
    response("retry", {}),
    response("assess", { outcome: "achieved", evidence: "Focus moved right" }),
    response("finish", { status: "completed", reason: "Focus is on the target" }),
  ];
  const model = new MockLanguageModelV4({
    modelId: "mock-navigation",
    doGenerate: () => replies.shift() ?? stopped(),
  });
  const operations: DeviceOperation[] = [];
  let captures = 0;
  let artifact: NavigationRunArtifact | undefined;
  const result = await runNavigationAgent(
    {
      model,
      timeoutMs: 1_000,
      settleMs: 0,
      settle: async () => undefined,
      capture: async () => ({
        record: record({ kind: "screen.capture", format: "png" }, ++captures),
        bytes: Buffer.from(images["image/png"]),
        mediaType: "image/png",
      }),
      execute: async (operation) => {
        operations.push(operation);
        return record(operation, 100 + operations.length);
      },
      publishArtifact: async (value) => {
        artifact = value;
      },
    },
    { goal: "Move right", maxSteps: 10 },
  );

  expect(result.status).toBe("completed");
  expect(operations).toEqual([
    { kind: "control.press", key: "RIGHT" },
    { kind: "control.press", key: "RIGHT" },
  ]);
  expect(artifact?.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        toolName: "retry",
        transition: expect.objectContaining({ retryDecision: "executed", retryCount: 1 }),
      }),
    ]),
  );
});

test("blocks when the one permitted retry still has no visible change", async () => {
  const expectedVisibleChange = "Focus moves right";
  const replies = [
    response("press", { key: "RIGHT", expectedVisibleChange }),
    response("assess", { outcome: "no-change", evidence: "Focus stayed put" }),
    response("observe", {}),
    response("assess", { outcome: "no-change", evidence: "Focus still stayed put" }),
    response("retry", {}),
    response("assess", { outcome: "no-change", evidence: "Retry had no effect" }),
  ];
  const model = new MockLanguageModelV4({
    modelId: "mock-navigation",
    doGenerate: () => replies.shift() ?? stopped(),
  });
  const operations: DeviceOperation[] = [];
  let captures = 0;
  const result = await runNavigationAgent(
    {
      model,
      timeoutMs: 1_000,
      settleMs: 0,
      settle: async () => undefined,
      capture: async () => ({
        record: record({ kind: "screen.capture", format: "png" }, ++captures),
        bytes: images["image/png"],
        mediaType: "image/png",
      }),
      execute: async (operation) => {
        operations.push(operation);
        return record(operation, 100 + operations.length);
      },
    },
    { goal: "Move right", maxSteps: 10 },
  );

  expect(result).toMatchObject({ status: "blocked", terminationReason: "blocked" });
  expect(operations).toHaveLength(2);
  expect(model.doGenerateCalls).toHaveLength(6);
});

test("replans when the retry screenshot visibly changed", async () => {
  const expectedVisibleChange = "Focus moves right";
  const replies = [
    response("press", { key: "RIGHT", expectedVisibleChange }),
    response("assess", { outcome: "no-change", evidence: "Focus stayed put" }),
    response("observe", {}),
    response("assess", { outcome: "no-change", evidence: "Focus still stayed put" }),
    response("retry", {}),
    response("assess", { outcome: "no-change", evidence: "The goal was not reached" }),
    response("press", { key: "LEFT", expectedVisibleChange: "Focus moves left" }),
    response("assess", { outcome: "achieved", evidence: "Focus moved left" }),
    response("finish", { status: "completed", reason: "Focus is on the target" }),
  ];
  const model = new MockLanguageModelV4({
    modelId: "mock-navigation",
    doGenerate: () => replies.shift() ?? stopped(),
  });
  const operations: DeviceOperation[] = [];
  let captures = 0;
  let artifact: NavigationRunArtifact | undefined;
  const result = await runNavigationAgent(
    {
      model,
      timeoutMs: 1_000,
      settleMs: 0,
      settle: async () => undefined,
      capture: async () => {
        captures += 1;
        const bytes = Buffer.from(images["image/png"]);
        bytes[bytes.length - 1] = captures < 4 ? 1 : captures;
        return {
          record: record({ kind: "screen.capture", format: "png" }, captures),
          bytes,
          mediaType: "image/png",
        };
      },
      execute: async (operation) => {
        operations.push(operation);
        return record(operation, 100 + operations.length);
      },
      publishArtifact: async (value) => {
        artifact = value;
      },
    },
    { goal: "Move to the target", maxSteps: 10 },
  );

  expect(result.status).toBe("completed");
  expect(operations).toEqual([
    { kind: "control.press", key: "RIGHT" },
    { kind: "control.press", key: "RIGHT" },
    { kind: "control.press", key: "LEFT" },
  ]);
  expect(artifact?.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        toolName: "assess",
        transition: expect.objectContaining({
          retryCount: 1,
          retryDecision: "denied-screen-changed",
        }),
      }),
    ]),
  );
});

test("unexpected transition permits replanning without repeating the action", async () => {
  const replies = [
    response("press", { key: "RIGHT", expectedVisibleChange: "Focus moves right" }),
    response("assess", { outcome: "unexpected", evidence: "A dialog appeared" }),
    response("press", { key: "LEFT", expectedVisibleChange: "Dialog selection moves left" }),
    response("assess", { outcome: "achieved", evidence: "Dialog selection moved left" }),
    response("finish", { status: "completed", reason: "Safe choice is selected" }),
  ];
  const model = new MockLanguageModelV4({
    modelId: "mock-navigation",
    doGenerate: () => replies.shift() ?? stopped(),
  });
  const operations: DeviceOperation[] = [];
  let captures = 0;
  const result = await runNavigationAgent(
    {
      model,
      timeoutMs: 1_000,
      settleMs: 0,
      settle: async () => undefined,
      capture: async () => ({
        record: record({ kind: "screen.capture", format: "png" }, ++captures),
        bytes: images["image/png"],
        mediaType: "image/png",
      }),
      execute: async (operation) => {
        operations.push(operation);
        return record(operation, 100 + operations.length);
      },
    },
    { goal: "Choose safely", maxSteps: 10 },
  );

  expect(result.status).toBe("completed");
  expect(operations).toEqual([
    { kind: "control.press", key: "RIGHT" },
    { kind: "control.press", key: "LEFT" },
  ]);
});

test("retries only the screenshot after an action capture fails twice", async () => {
  let modelCalls = 0;
  const sharedImage = Buffer.from(images["image/png"]);
  const model = new MockLanguageModelV4({
    modelId: "mock-navigation",
    doGenerate: () => {
      modelCalls += 1;
      if (modelCalls === 1) {
        sharedImage[sharedImage.length - 1] += 1;
        return response("press", {
          key: "RIGHT",
          expectedVisibleChange: "Focus moves right",
        });
      }
      return modelCalls === 2
        ? response("assess", { outcome: "achieved", evidence: "Focus moved right" })
        : response("finish", { status: "completed", reason: "Focus moved right" });
    },
  });
  const operations: DeviceOperation[] = [];
  let captureCalls = 0;
  const settleAfterCaptureCalls: number[] = [];
  let artifact: NavigationRunArtifact | undefined;
  const result = await runNavigationAgent(
    {
      model,
      timeoutMs: 1_000,
      settleMs: 0,
      settle: async () => {
        settleAfterCaptureCalls.push(captureCalls);
      },
      capture: async () => {
        captureCalls += 1;
        if (captureCalls === 2 || captureCalls === 3) throw new Error("camera busy");
        return {
          record: record({ kind: "screen.capture", format: "png" }, captureCalls),
          bytes: sharedImage,
          mediaType: "image/png",
        };
      },
      execute: async (operation) => {
        operations.push(operation);
        return record(operation, 100 + operations.length);
      },
      publishArtifact: async (value) => {
        artifact = value;
      },
    },
    { goal: "Move right", maxSteps: 6 },
  );

  expect(result.status).toBe("completed");
  expect(operations).toEqual([{ kind: "control.press", key: "RIGHT" }]);
  expect(settleAfterCaptureCalls).toEqual([1, 2, 3]);
  expect(artifact?.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "tool-result",
        toolName: "press",
        capture: expect.objectContaining({
          attempts: 3,
          recovered: true,
          identicalToPrevious: false,
        }),
      }),
    ]),
  );
});

test("cancels during the capture retry wait", async () => {
  const controller = new AbortController();
  const model = new MockLanguageModelV4({
    modelId: "mock-navigation",
    doGenerate: response("press", {
      key: "RIGHT",
      expectedVisibleChange: "Focus moves right",
    }),
  });
  let captures = 0;
  let settles = 0;
  let mutations = 0;
  await expect(
    runNavigationAgent(
      {
        model,
        signal: controller.signal,
        timeoutMs: 1_000,
        settle: async (_ms, signal) => {
          settles += 1;
          if (settles === 2) controller.abort(new Error("Interrupted during retry wait"));
          signal?.throwIfAborted();
        },
        capture: async () => {
          captures += 1;
          if (captures > 1) throw new Error("camera busy");
          return {
            record: record({ kind: "screen.capture", format: "png" }, captures),
            bytes: images["image/png"],
            mediaType: "image/png",
          };
        },
        execute: async (operation) => {
          mutations += 1;
          return record(operation, 10);
        },
      },
      { goal: "Move right", maxSteps: 4 },
    ),
  ).rejects.toThrow("Interrupted during retry wait");
  expect({ captures, settles, mutations, modelCalls: model.doGenerateCalls.length }).toEqual({
    captures: 2,
    settles: 2,
    mutations: 1,
    modelCalls: 1,
  });
});

test("capture exhaustion stops before another model call or mutation", async () => {
  let modelCalls = 0;
  const model = new MockLanguageModelV4({
    modelId: "mock-navigation",
    doGenerate: () => {
      modelCalls += 1;
      return modelCalls === 1
        ? response("press", {
            key: "RIGHT",
            expectedVisibleChange: "Focus moves right",
          })
        : response("press", {
            key: "LEFT",
            expectedVisibleChange: "Focus moves left",
          });
    },
  });
  const operations: DeviceOperation[] = [];
  let captureCalls = 0;
  await expect(
    runNavigationAgent(
      {
        model,
        timeoutMs: 1_000,
        settleMs: 0,
        settle: async () => undefined,
        capture: async () => {
          captureCalls += 1;
          if (captureCalls > 1) throw new Error("camera unavailable");
          return {
            record: record({ kind: "screen.capture", format: "png" }, captureCalls),
            bytes: images["image/png"],
            mediaType: "image/png",
          };
        },
        execute: async (operation) => {
          operations.push(operation);
          return record(operation, 100 + operations.length);
        },
      },
      { goal: "Move right", maxSteps: 6 },
    ),
  ).rejects.toThrow("screenshot capture failed");

  expect(model.doGenerateCalls).toHaveLength(1);
  expect(operations).toEqual([{ kind: "control.press", key: "RIGHT" }]);
  expect(captureCalls).toBe(4);
});

test.each([
  Number.NaN,
  Number.POSITIVE_INFINITY,
])("rejects invalid capture ordinal %p", async (ordinal) => {
  const model = new MockLanguageModelV4({ modelId: "mock-navigation", doGenerate: stopped() });
  await expect(
    runNavigationAgent(
      {
        model,
        timeoutMs: 1_000,
        settleMs: 0,
        capture: async () => ({
          record: record({ kind: "screen.capture", format: "png" }, ordinal),
          bytes: images["image/png"],
          mediaType: "image/png",
        }),
        execute: async (operation) => record(operation, 1),
      },
      { goal: "Observe" },
    ),
  ).rejects.toThrow("finite positive integer");
  expect(model.doGenerateCalls).toHaveLength(0);
});
