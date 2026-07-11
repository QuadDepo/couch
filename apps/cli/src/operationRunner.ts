import type {
  DeviceInventory,
  DeviceOperation,
  DeviceSession,
  OperationKind,
  OperationRecord,
} from "@couch/device";
import { type CouchTestConfig, resolveTarget, type TestTargetConfig } from "@couch/runner/config";
import type { CommandError } from "./errors";
import { errorDetails } from "./errors";
import type { SignalControl } from "./processSignals";

export interface SessionOutcome<TContext> {
  operations: OperationRecord[];
  context: TContext | undefined;
  caughtError: CommandError | undefined;
  cleanupError: CommandError | undefined;
}

// Runs the open -> register-cleanup -> execute -> cleanup lifecycle shared by
// every session-backed command. `open` produces the session plus whatever the
// command needs afterward (its `context`); `execute` issues the operations.
// Thrown values are normalized to a CommandError so callers branch on a typed
// error rather than the raw thrown value's truthiness.
export async function runSession<TContext>(
  signals: SignalControl,
  open: () => Promise<{ session: DeviceSession; context: TContext }>,
  execute: (session: DeviceSession, context: TContext) => Promise<readonly OperationRecord[]>,
): Promise<SessionOutcome<TContext>> {
  const operations: OperationRecord[] = [];
  let session: DeviceSession | undefined;
  let context: TContext | undefined;
  let caughtError: CommandError | undefined;
  let cleanupError: CommandError | undefined;

  try {
    const opened = await open();
    session = opened.session;
    context = opened.context;
    signals.setCleanup(() => session?.close() ?? Promise.resolve());
    operations.push(...(await execute(opened.session, opened.context)));
  } catch (error) {
    caughtError = errorDetails(error);
  } finally {
    if (session) cleanupError = await signals.cleanup();
  }

  return { operations, context, caughtError, cleanupError };
}

// The config-backed commands (launch, foreground, screenshot) all resolve a
// target alias, open a session requiring a capability, and run a single
// operation against the resolved target.
export async function runTargetSession(params: {
  targetAlias: string;
  require: readonly OperationKind[];
  getInventory: () => Promise<DeviceInventory>;
  signals: SignalControl;
  loadProjectConfig: () => Promise<CouchTestConfig>;
  operationFor: (target: TestTargetConfig) => DeviceOperation;
}): Promise<SessionOutcome<TestTargetConfig>> {
  return runSession(
    params.signals,
    async () => {
      const target = resolveTarget(await params.loadProjectConfig(), params.targetAlias);
      const session = await (await params.getInventory()).openSession(target.deviceId, {
        require: params.require,
        signal: params.signals.signal,
      });
      return { session, context: target };
    },
    async (session, target) => [
      await session.execute(params.operationFor(target), {
        signal: params.signals.signal,
        timeoutMs: target.operationTimeoutMs,
      }),
    ],
  );
}

// Maps a completed (but non-successful) operation to a CommandError, falling
// back to a generic message when the operation carries no error of its own.
export function operationError(
  operation: OperationRecord | undefined,
  fallbackMessage: string,
): CommandError {
  if (operation?.error) return { code: operation.error.code, message: operation.error.message };
  return { code: "operation-failed", message: fallbackMessage };
}
