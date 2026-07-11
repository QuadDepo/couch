import type { DeviceInventory } from "@couch/device";
import { type CouchTestConfig, loadConfig } from "@couch/runner/config";
import { operationError, runTargetSession } from "../operationRunner";
import type { SignalControl } from "../processSignals";
import { cancelledAppResult, failedAppResult, parseApp } from "./shared";
import type { AppCommandResult, ParsedAppCommand } from "./types";

export function parseLaunch(args: readonly string[]): ParsedAppCommand<"app.launch"> {
  return parseApp(args, "app.launch");
}

export async function runLaunch(
  command: ParsedAppCommand<"app.launch">,
  getInventory: () => Promise<DeviceInventory>,
  signals: SignalControl,
  loadProjectConfig: () => Promise<CouchTestConfig> = loadConfig,
): Promise<AppCommandResult> {
  const outcome = await runTargetSession({
    targetAlias: command.targetAlias,
    require: ["app.launch"],
    getInventory,
    signals,
    loadProjectConfig,
    operationFor: (target) => ({
      kind: "app.launch",
      appId: target.app.id,
      activity: target.app.activity,
    }),
  });

  const operation = outcome.operations[0];
  const deviceId = outcome.context?.deviceId;

  if (signals.exitCode || operation?.status === "cancelled") {
    return cancelledAppResult(command, outcome.operations, deviceId, signals, outcome.cleanupError);
  }
  if (outcome.caughtError) {
    return failedAppResult(
      command,
      outcome.operations,
      deviceId,
      outcome.caughtError,
      outcome.cleanupError,
    );
  }
  if (outcome.cleanupError) {
    return failedAppResult(command, outcome.operations, deviceId, undefined, outcome.cleanupError);
  }
  if (operation?.status !== "succeeded") {
    return failedAppResult(
      command,
      outcome.operations,
      deviceId,
      operationError(operation, "App launch did not complete"),
    );
  }

  return {
    resultVersion: 1,
    command: command.command,
    targetAlias: command.targetAlias,
    ...(deviceId ? { deviceId } : {}),
    status: "succeeded",
    exitCode: 0,
    operations: outcome.operations,
  };
}
