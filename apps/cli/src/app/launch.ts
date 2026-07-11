import type { DeviceInventory, DeviceSession, OperationRecord } from "@couch/device";
import {
  type CouchTestConfig,
  loadConfig,
  resolveTarget,
  type TestTargetConfig,
} from "@couch/runner/config";
import type { CommandError } from "../errors";
import { errorDetails, FAILURE_EXIT, UsageError } from "../errors";
import type { SignalControl } from "../processSignals";
import type { AppCommandResult, ParsedAppCommand } from "./types";

export function parseLaunch(args: readonly string[]): ParsedAppCommand {
  return parseApp(args, "app.launch");
}

export function parseApp(
  args: readonly string[],
  command: ParsedAppCommand["command"],
): ParsedAppCommand {
  const targetAlias = args[0];
  if (!targetAlias || targetAlias.startsWith("-"))
    throw new UsageError(`expected: couch ${command.replace(".", " ")} <target>`);
  let json = false;
  for (const argument of args.slice(1)) {
    if (argument === "--json" && !json) json = true;
    else
      throw new UsageError(
        argument === "--json" ? "--json may only be specified once" : `unknown option: ${argument}`,
      );
  }
  return { command, targetAlias, json };
}

export async function runLaunch(
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
      require: ["app.launch"],
      signal: signals.signal,
    });
    signals.setCleanup(() => session?.close() ?? Promise.resolve());
    operations.push(
      await session.execute(
        { kind: "app.launch", appId: target.app.id, activity: target.app.activity },
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
        : { code: "operation-failed", message: "App launch did not complete" },
      deviceId,
    );
  }
  return {
    resultVersion: 1,
    command: "app.launch",
    targetAlias: command.targetAlias,
    deviceId: target.deviceId,
    status: "succeeded",
    exitCode: 0,
    operations,
  };
}

export function failed(
  command: ParsedAppCommand,
  operations: readonly OperationRecord[],
  error: { code: string; message: string },
  deviceId?: string,
  cleanupError?: CommandError,
): AppCommandResult {
  return {
    resultVersion: 1,
    command: command.command,
    targetAlias: command.targetAlias,
    ...(deviceId ? { deviceId } : {}),
    status: "failed",
    exitCode: FAILURE_EXIT,
    operations,
    error,
    ...(cleanupError ? { cleanupError } : {}),
  };
}

export function cancelled(
  command: ParsedAppCommand,
  deviceId: string | undefined,
  operations: readonly OperationRecord[],
  signals: SignalControl,
  cleanupError?: CommandError,
): AppCommandResult {
  return {
    resultVersion: 1,
    command: command.command,
    targetAlias: command.targetAlias,
    ...(deviceId ? { deviceId } : {}),
    status: "cancelled",
    exitCode: signals.exitCode ?? 130,
    operations,
    error: { code: "cancelled", message: signals.message ?? "Interrupted" },
    ...(cleanupError ? { cleanupError } : {}),
  };
}

export function humanApp(result: AppCommandResult): string {
  return `${result.command} ${result.targetAlias}: ${result.status}\n`;
}
