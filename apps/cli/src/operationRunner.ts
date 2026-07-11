import type {
  DeviceDescriptor,
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
  validateFor?: (target: TestTargetConfig, device: DeviceDescriptor) => void;
}): Promise<SessionOutcome<TestTargetConfig>> {
  return runSession(
    params.signals,
    async () => {
      const target = resolveTarget(await params.loadProjectConfig(), params.targetAlias);
      const inventory = await params.getInventory();
      const device = await inventory.getDevice(target.deviceId, { signal: params.signals.signal });
      params.validateFor?.(target, device);
      const session = await inventory.openSession(target.deviceId, {
        require: params.require,
        allowExperimental: target.allowExperimental,
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

export type OutcomeClassification =
  | { kind: "cancelled" }
  | { kind: "failed"; error?: CommandError; cleanupError?: CommandError }
  | { kind: "succeeded" };

// Collapses the cancel -> caughtError -> cleanupError -> operation-not-succeeded
// cascade shared by the single-operation target commands into one verdict, so
// each command keeps only its success builder and genuine special cases.
export function classifyOutcome(
  signals: SignalControl,
  outcome: SessionOutcome<unknown>,
  notSucceededMessage: string,
): OutcomeClassification {
  const operation = outcome.operations[0];
  if (signals.exitCode || operation?.status === "cancelled") return { kind: "cancelled" };
  if (outcome.caughtError) {
    return { kind: "failed", error: outcome.caughtError, cleanupError: outcome.cleanupError };
  }
  if (outcome.cleanupError) return { kind: "failed", cleanupError: outcome.cleanupError };
  if (operation?.status !== "succeeded") {
    return { kind: "failed", error: operationError(operation, notSucceededMessage) };
  }
  return { kind: "succeeded" };
}

// Maps a completed (but non-successful) operation to a CommandError, falling
// back to a generic message when the operation carries no error of its own.
function operationError(
  operation: OperationRecord | undefined,
  fallbackMessage: string,
): CommandError {
  if (operation?.error) return { code: operation.error.code, message: operation.error.message };
  return { code: "operation-failed", message: fallbackMessage };
}
