import { describe, expect, test } from "bun:test";
import { formatTestEvent } from "./reporter";

describe("test reporter", () => {
  test("prints semantic events and hides captures", () => {
    expect(
      formatTestEvent({
        type: "device-operation-start",
        kind: "screen.capture",
        input: { path: "secret.png" },
        at: "2026-01-01T00:00:00.000Z",
      }),
    ).toBeUndefined();
    expect(
      formatTestEvent({
        type: "device-operation-start",
        kind: "control.press",
        input: { key: "LEFT" },
        at: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe("  action: press LEFT");
    expect(
      formatTestEvent({
        type: "assertion",
        assertion: {
          id: "a",
          matcher: "equal",
          label: "Home screen is ready",
          status: "failed",
          error: { code: "x", message: "nope" },
        },
        at: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe("  assertion: Home screen is ready → failed — nope");
    expect(
      formatTestEvent({
        type: "agent-tool-start",
        toolCallId: "tool-1",
        toolName: "observe",
        input: {},
        at: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe("    tool: observe");
    expect(
      formatTestEvent({
        type: "agent-tool-start",
        toolCallId: "tool-2",
        toolName: "screen.capture",
        input: {},
        at: "2026-01-01T00:00:00.000Z",
      }),
    ).toBeUndefined();
    expect(
      formatTestEvent({
        type: "screen-question-finish",
        status: "succeeded",
        modelId: "private-model",
        result: '{"answer":"ready"}',
        at: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe('    result: succeeded — {"answer":"ready"}');
  });

  test("redacts terminal control characters and secrets", () => {
    expect(
      formatTestEvent({
        type: "agent-decision",
        toolName: "observe",
        decision: "use",
        reason: "token=hidden\u001b[2J",
        at: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe("    decision: observe → use — token=[redacted] [2J");
  });
});
