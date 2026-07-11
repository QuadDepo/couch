import type { DeviceInventory, OperationRecord } from "@couch/device";
import { type CouchTestConfig, loadConfig } from "@couch/runner/config";
import { cancelledFields, failedFields } from "../commandOutput";
import type { CommandError } from "../errors";
import { UsageError } from "../errors";
import { classifyOutcome, runTargetSession } from "../operationRunner";
import { parseOptions } from "../parseOptions";
import type { SignalControl } from "../processSignals";
import type { ParsedScreenshot, ScreenshotResult } from "./types";

export function parseScreenshot(args: readonly string[]): ParsedScreenshot {
  const targetAlias = args[0];
  if (!targetAlias || targetAlias.startsWith("-")) {
    throw new UsageError("expected: couch screenshot <target> --out <path>");
  }
  const { json, values } = parseOptions(args, 1, [
    { flag: "--out", message: "--out expects a path" },
  ]);
  const out = values["--out"];
  if (!out) throw new UsageError("--out expects a path");
  return { command: "screenshot", targetAlias, out, json };
}

export async function runScreenshot(
  command: ParsedScreenshot,
  getInventory: () => Promise<DeviceInventory>,
  signals: SignalControl,
  loadProjectConfig: () => Promise<CouchTestConfig> = loadConfig,
): Promise<ScreenshotResult> {
  const outcome = await runTargetSession({
    targetAlias: command.targetAlias,
    require: ["screen.capture"],
    getInventory,
    signals,
    loadProjectConfig,
    operationFor: () => ({ kind: "screen.capture", format: "png", path: command.out }),
  });

  const classification = classifyOutcome(signals, outcome, "Screenshot capture did not complete");
  if (classification.kind === "cancelled") {
    return {
      resultVersion: 1,
      command: "screenshot",
      targetAlias: command.targetAlias,
      out: command.out,
      operations: outcome.operations,
      ...cancelledFields(signals, outcome.cleanupError),
    };
  }
  if (classification.kind === "failed") {
    return screenshotFailed(
      command,
      outcome.operations,
      classification.error,
      classification.cleanupError,
    );
  }

  return {
    resultVersion: 1,
    command: "screenshot",
    targetAlias: command.targetAlias,
    out: command.out,
    status: "succeeded",
    exitCode: 0,
    operations: outcome.operations,
  };
}

function screenshotFailed(
  command: ParsedScreenshot,
  operations: readonly OperationRecord[],
  error?: CommandError,
  cleanupError?: CommandError,
): ScreenshotResult {
  return {
    resultVersion: 1,
    command: "screenshot",
    targetAlias: command.targetAlias,
    out: command.out,
    operations,
    ...failedFields(error, cleanupError),
  };
}

export function formatScreenshotResult(result: ScreenshotResult): string {
  return `screenshot ${result.targetAlias}: ${result.status} ${result.out}\n`;
}
