import type { DeviceInventory } from "@couch/device";
import { runTvTest } from "@couch/runner/runner";
import { cancellationError } from "../commandOutput";
import { errorDetails, FAILURE_EXIT, UsageError } from "../errors";
import { parseOptions } from "../parseOptions";
import type { SignalControl } from "../processSignals";
import type { ParsedTest, TestCommandResult } from "./types";

export function parseTest(args: readonly string[]): ParsedTest {
  const file = args[0];
  if (!file || file.startsWith("-"))
    throw new UsageError("expected: couch test <file> --target <alias>");
  const { json, values } = parseOptions(args, 1, [
    { flag: "--target", message: "--target expects an alias" },
  ]);
  const targetAlias = values["--target"];
  if (!targetAlias) throw new UsageError("--target expects an alias");
  return { command: "test", file, targetAlias, json };
}

export async function runTest(
  command: ParsedTest,
  getInventory: () => Promise<DeviceInventory>,
  signals: SignalControl,
  diagnostics: string[],
  executeTest: typeof runTvTest = runTvTest,
): Promise<TestCommandResult> {
  let outcome: Awaited<ReturnType<typeof runTvTest>>;
  try {
    outcome = await executeTest({
      file: command.file,
      targetAlias: command.targetAlias,
      inventory: getInventory,
      signal: signals.signal,
      signalExitCode: () => signals.exitCode,
      diagnostics,
    });
  } catch (error) {
    return {
      resultVersion: 1,
      command: "test",
      file: command.file,
      targetAlias: command.targetAlias,
      status: signals.exitCode ? "cancelled" : "infrastructure-failed",
      exitCode: signals.exitCode ?? FAILURE_EXIT,
      error: signals.exitCode ? cancellationError(signals) : errorDetails(error),
    };
  }
  return {
    resultVersion: 1,
    command: "test",
    file: command.file,
    targetAlias: command.targetAlias,
    status: outcome.result.status,
    exitCode: outcome.result.exitCode,
    ...(outcome.artifactDirectory ? { artifactDirectory: outcome.artifactDirectory } : {}),
    ...(outcome.trace ? { trace: outcome.trace } : {}),
    ...(outcome.result.error ? { error: outcome.result.error } : {}),
    ...(outcome.result.cleanupError ? { cleanupError: outcome.result.cleanupError } : {}),
  };
}
export function formatTestResult(result: TestCommandResult): string {
  return `test ${result.targetAlias} ${result.file}: ${result.status}${result.artifactDirectory ? ` (${result.artifactDirectory})` : ""}\n`;
}
