import type { DeviceInventory, DeviceSession, OperationRecord } from "@couch/device";
import {
  type CouchTestConfig,
  loadConfig,
  resolveTarget,
  type TestTargetConfig,
} from "@couch/runner/config";
import type { CommandError } from "../errors";
import { errorDetails, FAILURE_EXIT } from "../errors";
import type { SignalControl } from "../processSignals";
import { cancelled, failed, parseApp } from "./launch";
import type { AppCommandResult, ParsedAppCommand } from "./types";

export function parseForeground(args: readonly string[]): ParsedAppCommand {
  return parseApp(args, "app.foreground");
}

export async function runForeground(
  command: ParsedAppCommand,
  getInventory: () => Promise<DeviceInventory>,
  signals: SignalControl,
  loadProjectConfig: () => Promise<CouchTestConfig> = loadConfig,
): Promise<AppCommandResult> {
  const operations: OperationRecord[] = [];
  let target: TestTargetConfig | undefined;
  let session: DeviceSession | undefined;
  let caught: unknown;
  let cleanupError: CommandError | undefined;
  try {
    target = resolveTarget(await loadProjectConfig(), command.targetAlias);
    session = await (await getInventory()).openSession(target.deviceId, {
      require: ["app.foreground"],
      signal: signals.signal,
    });
    signals.setCleanup(() => session?.close() ?? Promise.resolve());
    operations.push(
      await session.execute(
        { kind: "app.foreground", appId: target.app.id },
        { signal: signals.signal, timeoutMs: target.operationTimeoutMs },
      ),
    );
  } catch (error) {
    caught = error;
  } finally {
    if (session) cleanupError = await signals.cleanup();
  }
  const operation = operations[0];
  const deviceId = target?.deviceId;
  if (signals.exitCode || operation?.status === "cancelled") {
    return cancelled(command, deviceId, operations, signals, cleanupError);
  }
  if (caught) return failed(command, operations, errorDetails(caught), deviceId, cleanupError);
  if (cleanupError) return failed(command, operations, cleanupError, deviceId, cleanupError);
  if (!target) {
    return failed(command, operations, { code: "target-not-found", message: "Target unavailable" });
  }
  if (operation?.status !== "succeeded") {
    return failed(
      command,
      operations,
      operation?.error
        ? { code: operation.error.code, message: operation.error.message }
        : { code: "operation-failed", message: "Foreground observation did not complete" },
      deviceId,
    );
  }
  const foreground = operation.metadata?.foreground === true;
  return {
    resultVersion: 1,
    command: "app.foreground",
    targetAlias: command.targetAlias,
    deviceId: target.deviceId,
    status: foreground ? "succeeded" : "failed",
    exitCode: foreground ? 0 : FAILURE_EXIT,
    operations,
    ...(!foreground
      ? { error: { code: "app-not-foreground", message: `${target.app.id} is not foreground` } }
      : {}),
  };
}
