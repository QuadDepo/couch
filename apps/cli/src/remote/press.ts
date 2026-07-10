import type { DeviceInventory, DeviceSession, OperationRecord } from "@couch/device";
import { isRemoteKey } from "@couch/device";
import type { CommandError } from "../errors";
import { errorDetails, FAILURE_EXIT, UsageError } from "../errors";
import type { SignalControl } from "../processSignals";
import type { ParsedPress, PressResult } from "./types";

export function parsePress(args: readonly string[]): ParsedPress {
  const targetId = args[0];
  const keyValue = args[1];
  if (!targetId || !keyValue || targetId.startsWith("-") || keyValue.startsWith("-")) {
    throw new UsageError("expected: couch remote press <target> <KEY>");
  }
  if (!isRemoteKey(keyValue)) throw new UsageError(`unknown remote key: ${keyValue}`);

  let requestedTimes = 1;
  let json = false;
  for (let index = 2; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json" && !json) {
      json = true;
      continue;
    }
    if (argument === "--json") throw new UsageError("--json may only be specified once");
    if (argument === "--times") {
      const value = args[++index];
      if (value === undefined) throw new UsageError("--times expects a positive integer");
      requestedTimes = parseTimes(value);
      continue;
    }
    throw new UsageError(`unknown option: ${argument}`);
  }
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
  const operations: OperationRecord[] = [];
  let session: DeviceSession | undefined;
  let caught: unknown;
  let cleanupError: CommandError | undefined;
  try {
    const inventory = await getInventory();
    session = await inventory.openSession(command.targetId, {
      require: ["control.press"],
      signal: signals.signal,
    });
    signals.setCleanup(() => session?.close() ?? Promise.resolve());
    for (let ordinal = 0; ordinal < command.requestedTimes; ordinal += 1) {
      const operation = await session.execute(
        { kind: "control.press", key: command.key },
        { signal: signals.signal },
      );
      operations.push(operation);
      if (operation.status !== "succeeded") break;
    }
  } catch (error) {
    caught = error;
  } finally {
    if (session) cleanupError = await signals.cleanup();
  }

  if (signals.exitCode) return cancelledPress(command, signals, operations, cleanupError);
  if (caught) return failedPress(command, operations, errorDetails(caught), cleanupError);
  if (cleanupError) return failedPress(command, operations, cleanupError);

  const operationError = operations.at(-1)?.error;
  const status = operations.at(-1)?.status ?? "failed";
  return {
    resultVersion: 1,
    command: "remote.press",
    targetId: command.targetId,
    key: command.key,
    requestedTimes: command.requestedTimes,
    status,
    exitCode: status === "succeeded" ? 0 : FAILURE_EXIT,
    operations,
    ...(operationError
      ? { error: { code: operationError.code, message: operationError.message } }
      : {}),
  };
}

function failedPress(
  command: ParsedPress,
  operations: readonly OperationRecord[],
  error: { code: string; message: string },
  cleanupError?: { code: string; message: string },
): PressResult {
  return {
    resultVersion: 1,
    command: "remote.press",
    targetId: command.targetId,
    key: command.key,
    requestedTimes: command.requestedTimes,
    status: "failed",
    exitCode: FAILURE_EXIT,
    operations,
    error,
    ...(cleanupError ? { cleanupError } : {}),
  };
}

function cancelledPress(
  command: ParsedPress,
  signals: SignalControl,
  operations: readonly OperationRecord[],
  cleanupError?: { code: string; message: string },
): PressResult {
  return {
    resultVersion: 1,
    command: "remote.press",
    targetId: command.targetId,
    key: command.key,
    requestedTimes: command.requestedTimes,
    status: "cancelled",
    exitCode: signals.exitCode ?? 130,
    operations,
    error: { code: "cancelled", message: signals.message ?? "Interrupted" },
    ...(cleanupError ? { cleanupError } : {}),
  };
}

export function humanPress(result: PressResult): string {
  const operations = result.operations.map((operation) => {
    const confirmation = operation.confirmation ? ` (${operation.confirmation})` : "";
    return `${operation.ordinal}/${result.requestedTimes} ${result.key} ${operation.status}${confirmation}`;
  });
  const summary = `remote.press ${result.targetId}: ${result.status} (${result.operations.length}/${result.requestedTimes})`;
  return `${[...operations, summary].join("\n")}\n`;
}
