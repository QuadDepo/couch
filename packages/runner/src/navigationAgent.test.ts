import { expect, test } from "bun:test";
import type { DeviceOperation, OperationRecord } from "@couch/device";
import { MockLanguageModelV4 } from "ai/test";
import { type NavigationFrame, runNavigationAgent } from "./navigationAgent";

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
  return {
    content: [
      {
        type: "tool-call" as const,
        toolCallId: crypto.randomUUID(),
        toolName,
        input: JSON.stringify(input),
      },
    ],
    finishReason: { unified: "tool-calls" as const, raw: "tool-calls" },
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
    doGenerate: () =>
      ++call === 1
        ? response("press", { key: "RIGHT" })
        : response("finish", { status: "completed", reason: "Goal is visible" }),
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

  expect(result).toEqual({ status: "blocked", reason: "Target is unavailable" });
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
