import type { DeviceInventory } from "@couch/device";
import { type CouchTestConfig, loadConfig } from "@couch/runner/config";
import { FAILURE_EXIT } from "../errors";
import { classifyOutcome, runTargetSession } from "../operationRunner";
import type { SignalControl } from "../processSignals";
import { cancelledAppResult, failedAppResult, parseApp } from "./shared";
import type { AppCommandResult, ParsedAppCommand } from "./types";

export function parseForeground(args: readonly string[]): ParsedAppCommand<"app.foreground"> {
  return parseApp(args, "app.foreground");
}

export async function runForeground(
  command: ParsedAppCommand<"app.foreground">,
  getInventory: () => Promise<DeviceInventory>,
  signals: SignalControl,
  loadProjectConfig: () => Promise<CouchTestConfig> = loadConfig,
): Promise<AppCommandResult> {
  const outcome = await runTargetSession({
    targetAlias: command.targetAlias,
    require: ["app.foreground"],
    getInventory,
    signals,
    loadProjectConfig,
    operationFor: (target) => ({ kind: "app.foreground", appId: target.app.id }),
  });

  const operation = outcome.operations[0];
  const target = outcome.context;
  const deviceId = target?.deviceId;

  const classification = classifyOutcome(
    signals,
    outcome,
    "Foreground observation did not complete",
  );
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

  // A succeeded operation implies the target resolved; guard so reading the app
  // id is sound and any real invariant violation surfaces as a crash.
  if (!target) throw new Error("app.foreground succeeded without a resolved target");

  const foreground = operation?.metadata?.foreground === true;
  return {
    resultVersion: 1,
    command: command.command,
    targetAlias: command.targetAlias,
    ...(deviceId ? { deviceId } : {}),
    status: foreground ? "succeeded" : "failed",
    exitCode: foreground ? 0 : FAILURE_EXIT,
    operations: outcome.operations,
    ...(foreground
      ? {}
      : { error: { code: "app-not-foreground", message: `${target.app.id} is not foreground` } }),
  };
}
