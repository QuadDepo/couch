import { expect, test } from "bun:test";
import { jsonSchema, Output } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { answerScreenQuestion } from "./screenQuestion";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAAB//8AAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AACwgAAQABAQERAP/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//dAAQAAf/aAAgBAQAAPwD8A6//2Q==",
  "base64",
);

function image(mediaType: "image/png" | "image/jpeg"): Uint8Array {
  return mediaType === "image/png" ? PNG : JPEG;
}

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function model(text: string) {
  return new MockLanguageModelV4({
    modelId: "mock-vision",
    doGenerate: {
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "stop" },
      usage,
      warnings: [],
      response: { id: "response", timestamp: new Date(0), modelId: "mock-response-model" },
    },
  });
}

test.each([
  ["image/png", "png"],
  ["image/jpeg", "jpeg"],
] as const)("answers a choice question with a %s capture", async (mediaType, label) => {
  const mock = model('{"result":"detail"}');
  const result = await answerScreenQuestion({
    image: image(mediaType),
    mediaType,
    question: `Which ${label} screen is visible?`,
    output: Output.choice({ options: ["home", "detail"] as const }),
    model: mock,
    timeoutMs: 1_000,
  });

  const inferred: "home" | "detail" = result.output;
  expect(inferred).toBe("detail");
  expect(result.modelId).toBe("mock-response-model");
  expect(mock.doGenerateCalls[0]?.prompt).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: "user",
        content: expect.arrayContaining([
          expect.objectContaining({
            type: "file",
            mediaType,
            data: expect.objectContaining({ type: "data", data: expect.any(Uint8Array) }),
          }),
        ]),
      }),
    ]),
  );
});

test("infers object output from a JSON Schema", async () => {
  type ScreenState = { page: string; menuOpen: boolean };
  const output = Output.object({
    schema: jsonSchema<ScreenState>({
      type: "object",
      properties: { page: { type: "string" }, menuOpen: { type: "boolean" } },
      required: ["page", "menuOpen"],
      additionalProperties: false,
    }),
  });
  const result = await answerScreenQuestion({
    image: PNG,
    mediaType: "image/png",
    question: "Describe the screen",
    output,
    model: model('{"page":"home","menuOpen":false}'),
    timeoutMs: 1_000,
  });

  const inferred: ScreenState = result.output;
  expect(inferred).toEqual({ page: "home", menuOpen: false });
});

test("sanitizes invalid structured output", async () => {
  await expect(
    answerScreenQuestion({
      image: PNG,
      mediaType: "image/png",
      question: "Which screen?",
      output: Output.choice({ options: ["home", "detail"] as const }),
      model: model("provider response that must not escape"),
      timeoutMs: 1_000,
    }),
  ).rejects.toThrow("Screen question returned invalid output");
});

test("preserves cancellation and sanitizes provider failures", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled by runner"));
  await expect(
    answerScreenQuestion({
      image: PNG,
      mediaType: "image/png",
      question: "Which screen?",
      output: Output.choice({ options: ["home", "detail"] as const }),
      model: model('{"result":"home"}'),
      timeoutMs: 1_000,
      signal: controller.signal,
    }),
  ).rejects.toThrow("cancelled by runner");

  const failingModel = new MockLanguageModelV4({
    doGenerate: () => {
      throw new Error("provider body with secret details");
    },
  });
  await expect(
    answerScreenQuestion({
      image: PNG,
      mediaType: "image/png",
      question: "Which screen?",
      output: Output.choice({ options: ["home", "detail"] as const }),
      model: failingModel,
      timeoutMs: 1_000,
    }),
  ).rejects.toThrow("Screen question request failed");
});

test("bounds requests with a sanitized timeout", async () => {
  const waitingModel = new MockLanguageModelV4({
    doGenerate: ({ abortSignal }) =>
      new Promise((_, reject) => {
        abortSignal?.addEventListener("abort", () => reject(abortSignal.reason), { once: true });
      }),
  });

  await expect(
    answerScreenQuestion({
      image: PNG,
      mediaType: "image/png",
      question: "Which screen?",
      output: Output.choice({ options: ["home", "detail"] as const }),
      model: waitingModel,
      timeoutMs: 1,
    }),
  ).rejects.toThrow("Screen question request timed out");
});

test("rejects malformed and mislabeled images before calling the model", async () => {
  const mock = model('{"result":"home"}');
  for (const [bytes, mediaType] of [
    [new Uint8Array([1, 2, 3]), "image/png"],
    [JPEG, "image/png"],
    [PNG, "image/jpeg"],
  ] as const) {
    await expect(
      answerScreenQuestion({
        image: bytes,
        mediaType,
        question: "Which screen?",
        output: Output.choice({ options: ["home", "detail"] as const }),
        model: mock,
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow("Screen question image is invalid");
  }
  expect(mock.doGenerateCalls).toHaveLength(0);
});
