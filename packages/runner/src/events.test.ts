import { expect, test } from "bun:test";
import { emitRunEvent, sanitizeOperationInput } from "./events";

test("event observers are synchronous and cannot fail a run", () => {
  const seen: string[] = [];
  emitRunEvent(
    (event) => {
      seen.push(event.type);
      throw new Error("observer failure");
    },
    { type: "run-start", runId: "run-1", targetAlias: "lab", file: "test.tv.ts", at: "now" },
  );
  expect(seen).toEqual(["run-start"]);
});

test("operation event inputs redact text and secrets", () => {
  expect(sanitizeOperationInput({ text: "hunter2", reason: "token=abc" })).toEqual({
    text: { length: 7, value: "[redacted]" },
    reason: "token=[redacted]",
  });
});

test("operation input sanitization recursively detaches nested values", () => {
  const input: Record<string, unknown> = {
    params: {
      text: "hunter2",
      reason: "password=abc",
      token: "raw-secret",
      values: ["token=xyz", { nested: "credential=secret" }],
    },
  };
  const sanitized = sanitizeOperationInput(input);

  expect(sanitized).toEqual({
    params: {
      text: { length: 7, value: "[redacted]" },
      reason: "password=[redacted]",
      token: "[redacted]",
      values: ["token=[redacted]", { nested: "credential=[redacted]" }],
    },
  });
  (input.params as Record<string, unknown>).reason = "changed";
  expect((sanitized.params as Record<string, unknown>).reason).toBe("password=[redacted]");
});

test("operation input sanitization bounds circular values", () => {
  const input: Record<string, unknown> = {};
  input.self = input;
  expect(sanitizeOperationInput(input)).toEqual({ self: "[Circular]" });
});

test("event payloads are sanitized and detached before observation", () => {
  const source = {
    type: "device-operation-start" as const,
    kind: "app.launch" as const,
    input: { params: { reason: "token=abc" } },
    at: "2026-01-01T00:00:00.000Z",
  };
  let observed: typeof source | undefined;
  let beforeMutation: typeof source | undefined;
  emitRunEvent((event) => {
    if (event.type !== "device-operation-start") throw new Error("unexpected event");
    observed = event;
    beforeMutation = structuredClone(event);
    event.input.params = { reason: "observer mutation" };
  }, source);

  expect(beforeMutation?.input).toEqual({ params: { reason: "token=[redacted]" } });
  expect(observed?.input).toEqual({ params: { reason: "observer mutation" } });
  expect(source.input).toEqual({ params: { reason: "token=abc" } });
});

test("async observer rejection is isolated", async () => {
  let unhandled = 0;
  const onUnhandled = () => {
    unhandled += 1;
  };
  process.on("unhandledRejection", onUnhandled);
  emitRunEvent(
    async () => {
      throw new Error("observer failure");
    },
    { type: "run-start", runId: "run-1", targetAlias: "lab", file: "test.tv.ts", at: "now" },
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  process.off("unhandledRejection", onUnhandled);
  expect(unhandled).toBe(0);
});
