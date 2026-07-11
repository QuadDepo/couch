import type { DeviceInventory } from "@couch/device";
import { runTvTest } from "@couch/runner/runner";
import { errorDetails, UsageError } from "../errors";
import type { SignalControl } from "../processSignals";
import type { ParsedTest, TestCommandResult } from "./types";

export function parseTest(args: readonly string[]): ParsedTest {
  const file = args[0];
  if (!file || file.startsWith("-"))
    throw new UsageError("expected: couch test <file> --target <alias>");
  let targetAlias: string | undefined;
  let json = false;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json" && !json) json = true;
    else if (argument === "--target" && !targetAlias) {
      const value = args[++index];
      if (!value || value.startsWith("-")) throw new UsageError("--target expects an alias");
      targetAlias = value;
    } else throw new UsageError(`unknown or duplicate option: ${argument}`);
  }
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
      exitCode: signals.exitCode ?? 2,
      error: signals.exitCode
        ? { code: "cancelled", message: signals.message ?? "Interrupted" }
        : errorDetails(error),
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
export function humanTest(result: TestCommandResult): string {
  return `test ${result.targetAlias} ${result.file}: ${result.status}${result.artifactDirectory ? ` (${result.artifactDirectory})` : ""}\n`;
}
