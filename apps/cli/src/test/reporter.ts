import { sanitizeEventText, type TestEvent, type TestEventObserver } from "@couch/runner/runner";

function operationLabel(event: Extract<TestEvent, { type: "device-operation-start" }>): string {
  const input = event.input;
  switch (event.kind) {
    case "control.press":
      return `press ${sanitizeEventText(input.key, "key")}`;
    case "control.text": {
      const value = input.text;
      return `type ${typeof value === "object" && value && "length" in value ? `${value.length} chars` : "text"}`;
    }
    case "app.launch":
      return `launch ${sanitizeEventText(input.appId, "app")}`;
    case "app.stop":
      return `stop ${sanitizeEventText(input.appId, "app")}`;
    case "app.foreground":
      return `check foreground ${sanitizeEventText(input.appId, "app")}`;
    case "device.wake":
      return "wake device";
    default:
      return event.kind;
  }
}

export function formatTestEvent(event: TestEvent): string | undefined {
  switch (event.type) {
    case "run-start":
      return `test ${sanitizeEventText(event.targetAlias, "target")} ${sanitizeEventText(event.file, "file")}`;
    case "run-finish":
      return `test ${event.status} (exit ${event.exitCode})`;
    case "device-operation-start":
      return formatOperationStart(event);
    case "device-operation-finish":
      return formatOperationFinish(event);
    case "assertion":
      return formatAssertion(event);
    case "screen-question-start":
      return `  screen question: ${sanitizeEventText(event.question, "started")}`;
    case "screen-question-finish":
      return `    result: ${event.status}${event.result ? ` — ${sanitizeEventText(event.result, "answered")}` : event.error ? ` — ${sanitizeEventText(event.error.message, "error")}` : ""}`;
    case "poll-retry":
      return `  poll retry: ${event.attempt}/${event.attempts} (${event.intervalMs}ms)`;
    case "agent-start":
      return formatAgentStart(event);
    case "agent-decision":
      return formatAgentDecision(event);
    case "agent-tool-start":
      return hiddenTool(event.toolName)
        ? undefined
        : `    tool: ${sanitizeEventText(event.toolName, "tool")}`;
    case "agent-tool-finish":
      return hiddenTool(event.toolName)
        ? undefined
        : `      result: ${event.success ? "succeeded" : "failed"}${event.error ? ` — ${sanitizeEventText(event.error.message, "error")}` : ""}`;
    case "agent-complete":
      return `  agent result: ${event.status} — ${sanitizeEventText(event.reason, event.terminationReason)}`;
    case "agent-failure":
      return `  agent failure: ${sanitizeEventText(event.stage, "run")} — ${sanitizeEventText(event.reason, "failed")}`;
  }
}

function formatOperationStart(
  event: Extract<TestEvent, { type: "device-operation-start" }>,
): string | undefined {
  return event.kind === "screen.capture" ? undefined : `  action: ${operationLabel(event)}`;
}

function formatOperationFinish(
  event: Extract<TestEvent, { type: "device-operation-finish" }>,
): string | undefined {
  if (event.kind === "screen.capture") return undefined;
  return `    result: ${event.status}${event.error ? ` — ${sanitizeEventText(event.error.message, event.error.code)}` : ""}`;
}

function formatAssertion(event: Extract<TestEvent, { type: "assertion" }>): string {
  const label = sanitizeEventText(event.assertion.label ?? event.assertion.matcher, "assertion");
  const error = event.assertion.error?.message;
  return `  assertion: ${label} → ${event.assertion.status}${error && error !== label ? ` — ${sanitizeEventText(error, event.assertion.error?.code ?? "failed")}` : ""}`;
}

function formatAgentStart(event: Extract<TestEvent, { type: "agent-start" }>): string {
  return `  agent: ${sanitizeEventText(event.goal, "goal")} (max steps ${event.maxSteps})`;
}

function formatAgentDecision(event: Extract<TestEvent, { type: "agent-decision" }>): string {
  return `    decision: ${sanitizeEventText(event.toolName, "tool")} → ${sanitizeEventText(event.decision, "decision")} — ${sanitizeEventText(event.reason, "")}`;
}

function hiddenTool(name: string): boolean {
  return /capture|protocol/i.test(name);
}

export function createTestReporter(write: (line: string) => void): TestEventObserver {
  return (event) => {
    const line = formatTestEvent(event);
    if (line) write(`${line}\n`);
  };
}
