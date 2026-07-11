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
import type { ParsedScreenshot, ScreenshotResult } from "./types";

export function parseScreenshot(args: readonly string[]): ParsedScreenshot {
  const targetAlias = args[0];
  if (!targetAlias || targetAlias.startsWith("-"))
    throw new UsageError("expected: couch screenshot <target> --out <path>");
  let out: string | undefined;
  let json = false;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json" && !json) json = true;
    else if (argument === "--out" && !out) {
      const value = args[++index];
      if (!value || value.startsWith("-")) throw new UsageError("--out expects a path");
      out = value;
    } else throw new UsageError(`unknown or duplicate option: ${argument}`);
  }
  if (!out) throw new UsageError("--out expects a path");
  return { command: "screenshot", targetAlias, out, json };
}

export async function runScreenshot(
  command: ParsedScreenshot,
  getInventory: () => Promise<DeviceInventory>,
  signals: SignalControl,
  loadProjectConfig: () => Promise<CouchTestConfig> = loadConfig,
): Promise<ScreenshotResult> {
  const operations: OperationRecord[] = [];
  let target: TestTargetConfig | undefined;
  let session: DeviceSession | undefined;
  let caught: unknown;
  let cleanupError: CommandError | undefined;
  try {
    target = resolveTarget(await loadProjectConfig(), command.targetAlias);
    session = await (await getInventory()).openSession(target.deviceId, {
      require: ["screen.capture"],
      signal: signals.signal,
    });
    signals.setCleanup(() => session?.close() ?? Promise.resolve());
    operations.push(
      await session.execute(
        { kind: "screen.capture", format: "png", path: command.out },
        { signal: signals.signal, timeoutMs: target.operationTimeoutMs },
      ),
    );
  } catch (error) {
    caught = error;
  } finally {
    if (session) cleanupError = await signals.cleanup();
  }
  const operation = operations[0];
  if (signals.exitCode || operation?.status === "cancelled") {
    return {
      resultVersion: 1,
      command: "screenshot",
      targetAlias: command.targetAlias,
      out: command.out,
      status: "cancelled",
      exitCode: signals.exitCode ?? 130,
      operations,
      error: { code: "cancelled", message: signals.message ?? "Interrupted" },
      ...(cleanupError ? { cleanupError } : {}),
    };
  }
  if (caught || cleanupError || !operation || operation.status !== "succeeded") {
    const error = caught
      ? errorDetails(caught)
      : (cleanupError ??
        (operation?.error
          ? { code: operation.error.code, message: operation.error.message }
          : { code: "operation-failed", message: "Screenshot capture did not complete" }));
    return {
      resultVersion: 1,
      command: "screenshot",
      targetAlias: command.targetAlias,
      out: command.out,
      status: "failed",
      exitCode: FAILURE_EXIT,
      operations,
      error,
      ...(cleanupError ? { cleanupError } : {}),
    };
  }
  return {
    resultVersion: 1,
    command: "screenshot",
    targetAlias: command.targetAlias,
    out: command.out,
    status: "succeeded",
    exitCode: 0,
    operations,
  };
}
export function humanScreenshot(result: ScreenshotResult): string {
  return `screenshot ${result.targetAlias}: ${result.status} ${result.out}\n`;
}
