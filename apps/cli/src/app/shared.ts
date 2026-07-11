import type { OperationRecord } from "@couch/device";
import { cancelledFields, failedFields } from "../commandOutput";
import type { CommandError } from "../errors";
import { UsageError } from "../errors";
import { parseOptions } from "../parseOptions";
import type { SignalControl } from "../processSignals";
import type { AppCommandKind, AppCommandResult, ParsedAppCommand } from "./types";

export function parseApp<K extends AppCommandKind>(
  args: readonly string[],
  command: K,
): ParsedAppCommand<K> {
  const targetAlias = args[0];
  if (!targetAlias || targetAlias.startsWith("-")) {
    throw new UsageError(`expected: couch ${command.replace(".", " ")} <target>`);
  }
  const { json } = parseOptions(args, 1);
  return { command, targetAlias, json };
}

export function failedAppResult(
  command: ParsedAppCommand,
  operations: readonly OperationRecord[],
  deviceId: string | undefined,
  error?: CommandError,
  cleanupError?: CommandError,
): AppCommandResult {
  return {
    resultVersion: 1,
    command: command.command,
    targetAlias: command.targetAlias,
    ...(deviceId ? { deviceId } : {}),
    operations,
    ...failedFields(error, cleanupError),
  };
}

export function cancelledAppResult(
  command: ParsedAppCommand,
  operations: readonly OperationRecord[],
  deviceId: string | undefined,
  signals: SignalControl,
  cleanupError?: CommandError,
): AppCommandResult {
  return {
    resultVersion: 1,
    command: command.command,
    targetAlias: command.targetAlias,
    ...(deviceId ? { deviceId } : {}),
    operations,
    ...cancelledFields(signals, cleanupError),
  };
}

export function formatAppResult(result: AppCommandResult): string {
  return `${result.command} ${result.targetAlias}: ${result.status}\n`;
}
