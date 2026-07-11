import type { ArtifactReference, DeviceSession, OperationRecord } from "@couch/device";
import { resolveContained, safeArtifactSegment } from "./artifacts";
import type { TestTargetConfig } from "./config";
import type { TvTestContext } from "./defineTvTest";
import type { AssertionRecord } from "./runner";

export class AssertionFailure extends Error {}

const DEFAULT_FOREGROUND_TIMEOUT_MS = 10_000;
const FOREGROUND_POLL_INTERVAL_MS = 250;

export type ExecuteOperation = (
  operation: Parameters<DeviceSession["execute"]>[0],
  runnerOwned?: boolean,
) => Promise<OperationRecord>;

function safeName(name: string): string {
  return safeArtifactSegment(name, "tv-test");
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveWait, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolveWait();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

function recordAssertion(
  assertions: AssertionRecord[],
  matcher: string,
  passed: boolean,
  failureMessage: string,
  details: { operationIds?: readonly string[]; artifacts?: readonly ArtifactReference[] } = {},
): void {
  assertions.push({
    id: crypto.randomUUID(),
    matcher,
    status: passed ? "passed" : "failed",
    operationIds: details.operationIds ?? [],
    artifacts: details.artifacts ?? [],
    ...(passed ? {} : { error: { code: "assertion-failed", message: failureMessage } }),
  });
}

export function buildTestContext(params: {
  execute: ExecuteOperation;
  target: TestTargetConfig;
  directory: string;
  operations: readonly OperationRecord[];
  assertions: AssertionRecord[];
  signal?: AbortSignal;
}): TvTestContext {
  const { execute, target, directory, operations, assertions, signal } = params;

  const foreground = async () => {
    const deadline = Date.now() + (target.foregroundTimeoutMs ?? DEFAULT_FOREGROUND_TIMEOUT_MS);
    while (true) {
      const record = await execute({ kind: "app.foreground", appId: target.app.id });
      if (record.metadata?.foreground === true) return record;
      if (Date.now() >= deadline) {
        const message = `${target.app.id} did not become foreground`;
        recordAssertion(assertions, "foreground", false, message, {
          operationIds: [record.id],
          artifacts: record.artifacts,
        });
        throw new AssertionFailure(message);
      }
      await wait(FOREGROUND_POLL_INTERVAL_MS, signal);
    }
  };

  return {
    tv: {
      app: {
        launch: () =>
          execute({
            kind: "app.launch",
            appId: target.app.id,
            activity: target.app.activity,
          }),
        foreground,
      },
      async press(key, pressOptions = {}) {
        const times = pressOptions.times ?? 1;
        for (let index = 0; index < times; index += 1) {
          await execute({ kind: "control.press", key });
          if (pressOptions.intervalMs && index + 1 < times) {
            await wait(pressOptions.intervalMs, signal);
          }
        }
      },
      screen: {
        capture: (name = "actual.png") =>
          execute({
            kind: "screen.capture",
            format: "png",
            path: resolveContained(directory, safeName(name)),
          }),
      },
    },
    expect: {
      foreground(record) {
        const candidate = record ?? operations.findLast((item) => item.kind === "app.foreground");
        const passed = candidate?.metadata?.foreground === true;
        recordAssertion(assertions, "foreground", passed, "Configured app is not foreground", {
          operationIds: candidate ? [candidate.id] : [],
          artifacts: candidate?.artifacts ?? [],
        });
        if (!passed) throw new AssertionFailure("Configured app is not foreground");
      },
      equal(actual, expected, message) {
        const passed = Object.is(actual, expected);
        const failureMessage =
          message ?? `Expected ${String(expected)}, received ${String(actual)}`;
        recordAssertion(assertions, "equal", passed, failureMessage);
        if (!passed) throw new AssertionFailure(failureMessage);
      },
    },
  };
}
