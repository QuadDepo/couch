import type { DeviceInventory } from "@couch/device";
import { type CouchTestConfig, loadConfig } from "@couch/runner/config";
import { classifyOutcome, runTargetSession } from "../operationRunner";
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

  const deviceId = outcome.context?.deviceId;

  const classification = classifyOutcome(signals, outcome, "App launch did not complete");
  if (classification.kind === "cancelled") {
    return cancelledAppResult(command, outcome.operations, deviceId, signals, outcome.cleanupError);
  }
  if (classification.kind === "failed") {
    return failedAppResult(
      command,
      outcome.operations,
      deviceId,
      classification.error,
      classification.cleanupError,
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
