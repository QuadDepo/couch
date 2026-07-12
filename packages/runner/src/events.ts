import type { OperationKind, OperationRecord } from "@couch/device";

export const MAX_EVENT_TEXT_LENGTH = 160;
const SENSITIVE_EVENT_KEY = /^(?:api[ _-]?key|token|password|secret|credential)$/iu;

export interface RunEventBase {
  at: string;
  runId?: string;
}

export type RunEvent =
  | (RunEventBase & {
      type: "run-start";
      runId: string;
      targetAlias: string;
      file: string;
    })
  | (RunEventBase & {
      type: "run-finish";
      runId: string;
      status: "passed" | "failed" | "infrastructure-failed" | "cancelled";
      exitCode: number;
    })
  | (RunEventBase & {
      type: "device-operation-start";
      kind: OperationKind;
      input: Record<string, unknown>;
      runnerOwned?: boolean;
    })
  | (RunEventBase & {
      type: "device-operation-finish";
      operationId: string;
      kind: OperationKind;
      status: OperationRecord["status"];
      error?: { code: string; message: string };
    })
  | (RunEventBase & {
      type: "assertion";
      assertion: {
        id: string;
        matcher: string;
        label?: string;
        status: "passed" | "failed";
        error?: { code: string; message: string };
      };
    })
  | (RunEventBase & {
      type: "screen-question-start";
      question: string;
    })
  | (RunEventBase & {
      type: "screen-question-finish";
      status: "succeeded" | "failed";
      modelId?: string;
      result?: string;
      error?: { message: string };
    })
  | (RunEventBase & {
      type: "poll-retry";
      attempt: number;
      attempts: number;
      intervalMs: number;
    })
  | (RunEventBase & {
      type: "agent-start";
      goal: string;
      maxSteps: number;
    })
  | (RunEventBase & {
      type: "agent-decision";
      toolName: string;
      decision: string;
      reason: string;
    })
  | (RunEventBase & {
      type: "agent-tool-start";
      toolCallId: string;
      toolName: string;
      input: Record<string, unknown>;
    })
  | (RunEventBase & {
      type: "agent-tool-finish";
      toolCallId: string;
      toolName: string;
      success: boolean;
      error?: { message: string };
    })
  | (RunEventBase & {
      type: "agent-complete";
      status: "completed" | "blocked" | "failed" | "cancelled";
      terminationReason: string;
      reason: string;
    })
  | (RunEventBase & {
      type: "agent-failure";
      stage: string;
      reason: string;
    });

export type RunEventObserver = (event: RunEvent) => void | PromiseLike<void>;
export type TestEvent = RunEvent;
export type TestEventObserver = RunEventObserver;

export function emitRunEvent(observer: RunEventObserver | undefined, event: RunEvent): void {
  if (!observer) return;
  try {
    // Keep observers outside the runner's result path, including async failures.
    void Promise.resolve(observer(sanitizeRunEvent(event))).catch(() => undefined);
  } catch {
    // Observability must never alter the test result.
  }
}

export function sanitizeEventText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const text = [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? " " : character;
    })
    .join("")
    .trim();
  if (!text) return fallback;
  return text
    .replace(/(api[ _-]?key|token|password|secret|credential)(\s*[:=]\s*)\S+/giu, "$1$2[redacted]")
    .slice(0, MAX_EVENT_TEXT_LENGTH);
}

export function sanitizeOperationInput(input: Record<string, unknown>): Record<string, unknown> {
  return sanitizeDetachedValue(input) as Record<string, unknown>;
}

function sanitizeRunEvent(event: RunEvent): RunEvent {
  return sanitizeDetachedValue(event) as RunEvent;
}

function sanitizeDetachedValue(
  value: unknown,
  key?: string,
  ancestors = new WeakSet<object>(),
): unknown {
  if (key === "text" && typeof value === "string") {
    return { length: [...value].length, value: "[redacted]" };
  }
  if (typeof value === "string" && key && SENSITIVE_EVENT_KEY.test(key)) {
    return "[redacted]";
  }
  if (typeof value === "string") return sanitizeEventText(value, "");
  if (!value || typeof value !== "object") return value;

  if (ancestors.has(value)) return "[Circular]";
  ancestors.add(value);
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const item of value) result.push(sanitizeDetachedValue(item, undefined, ancestors));
    ancestors.delete(value);
    return result;
  }

  const result: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    result[childKey] = sanitizeDetachedValue(childValue, childKey, ancestors);
  }
  ancestors.delete(value);
  return result;
}
