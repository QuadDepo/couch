import type { DeviceInventory, OperationRecord } from "@couch/device";
import { isRemoteKey } from "@couch/device";
import { cancelledFields, failedFields } from "../commandOutput";
import type { CommandError } from "../errors";
import { FAILURE_EXIT, UsageError } from "../errors";
import { runSession } from "../operationRunner";
import { parseOptions } from "../parseOptions";
import type { SignalControl } from "../processSignals";
import type { ParsedPress, PressResult } from "./types";

export function parsePress(args: readonly string[]): ParsedPress {
  const targetId = args[0];
  const keyValue = args[1];
  if (!targetId || !keyValue || targetId.startsWith("-") || keyValue.startsWith("-")) {
    throw new UsageError("expected: couch remote press <target> <KEY>");
  }
  if (!isRemoteKey(keyValue)) throw new UsageError(`unknown remote key: ${keyValue}`);

  const { json, values } = parseOptions(args, 2, [
    { flag: "--times", message: "--times expects a positive integer" },
  ]);
  const requestedTimes = values["--times"] !== undefined ? parseTimes(values["--times"]) : 1;

  return { command: "remote.press", targetId, key: keyValue, requestedTimes, json };
}

function parseTimes(value: string): number {
  if (!/^\d+$/.test(value)) throw new UsageError("--times expects a positive integer");
  const times = Number(value);
  if (!Number.isSafeInteger(times) || times < 1) {
    throw new UsageError("--times expects a positive integer");
  }
  return times;
}

export async function runPress(
  command: ParsedPress,
  getInventory: () => Promise<DeviceInventory>,
  signals: SignalControl,
): Promise<PressResult> {
  const outcome = await runSession(
    signals,
    async () => {
      const inventory = await getInventory();
      const session = await inventory.openSession(command.targetId, {
        require: ["control.press"],
        signal: signals.signal,
      });
      return { session, context: undefined };
    },
    async (session) => {
      const records: OperationRecord[] = [];
      for (let ordinal = 0; ordinal < command.requestedTimes; ordinal += 1) {
        const operation = await session.execute(
          { kind: "control.press", key: command.key },
          { signal: signals.signal },
        );
        records.push(operation);
        if (operation.status !== "succeeded") break;
      }
      return records;
    },
  );

  if (signals.exitCode) {
    return cancelledPress(command, signals, outcome.operations, outcome.cleanupError);
  }
  if (outcome.caughtError) {
    return failedPress(command, outcome.operations, outcome.caughtError, outcome.cleanupError);
  }
  if (outcome.cleanupError) {
    return failedPress(command, outcome.operations, undefined, outcome.cleanupError);
  }

  const last = outcome.operations.at(-1);
  const status = last?.status ?? "failed";
  return {
    resultVersion: 1,
    command: "remote.press",
    targetId: command.targetId,
    key: command.key,
    requestedTimes: command.requestedTimes,
    status,
    exitCode: status === "succeeded" ? 0 : FAILURE_EXIT,
    operations: outcome.operations,
    ...(last?.error ? { error: { code: last.error.code, message: last.error.message } } : {}),
  };
}

function failedPress(
  command: ParsedPress,
  operations: readonly OperationRecord[],
  error?: CommandError,
  cleanupError?: CommandError,
): PressResult {
  return {
    resultVersion: 1,
    command: "remote.press",
    targetId: command.targetId,
    key: command.key,
    requestedTimes: command.requestedTimes,
    operations,
    ...failedFields(error, cleanupError),
  };
}

function cancelledPress(
  command: ParsedPress,
  signals: SignalControl,
  operations: readonly OperationRecord[],
  cleanupError?: CommandError,
): PressResult {
  return {
    resultVersion: 1,
    command: "remote.press",
    targetId: command.targetId,
    key: command.key,
    requestedTimes: command.requestedTimes,
    operations,
    ...cancelledFields(signals, cleanupError),
  };
}

export function formatPressResult(result: PressResult): string {
  const operations = result.operations.map((operation) => {
    const confirmation = operation.confirmation ? ` (${operation.confirmation})` : "";
    return `${operation.ordinal}/${result.requestedTimes} ${result.key} ${operation.status}${confirmation}`;
  });
  const summary = `remote.press ${result.targetId}: ${result.status} (${result.operations.length}/${result.requestedTimes})`;
  return `${[...operations, summary].join("\n")}\n`;
}
