import type { AppCommandResult } from "./app/types";
import type { DeviceDoctorResult, DeviceListResult } from "./device/types";
import type { CommandError, CommandExitCode } from "./errors";
import { FAILURE_EXIT } from "./errors";
import type { SignalControl } from "./processSignals";
import type { PressResult } from "./remote/types";
import type { ScreenshotResult } from "./screenshot/types";
import type { TestCommandResult } from "./test/types";

export interface ResultBase {
  resultVersion: 1;
  status: string;
  exitCode: CommandExitCode;
  error?: CommandError;
  cleanupError?: CommandError;
}

export function cancellationError(signals: SignalControl): CommandError {
  return { code: "cancelled", message: signals.message ?? "Interrupted" };
}

// Shared status/exitCode/error fields for a cancelled result. A cleanup failure
// that happened while unwinding is kept in its own field, never folded into the
// primary cancellation error.
export function cancelledFields(
  signals: SignalControl,
  cleanupError?: CommandError,
): { status: "cancelled"; exitCode: 130 | 143; error: CommandError; cleanupError?: CommandError } {
  return {
    status: "cancelled",
    exitCode: signals.exitCode ?? 130,
    error: cancellationError(signals),
    ...(cleanupError ? { cleanupError } : {}),
  };
}

// Shared status/exitCode fields for a failed result. `error` describes the
// operation/runtime failure; `cleanupError` stays separate so a cleanup fault is
// never copied into both fields.
export function failedFields(
  error?: CommandError,
  cleanupError?: CommandError,
): {
  status: "failed";
  exitCode: typeof FAILURE_EXIT;
  error?: CommandError;
  cleanupError?: CommandError;
} {
  return {
    status: "failed",
    exitCode: FAILURE_EXIT,
    ...(error ? { error } : {}),
    ...(cleanupError ? { cleanupError } : {}),
  };
}

export type CliResult =
  | DeviceListResult
  | DeviceDoctorResult
  | PressResult
  | AppCommandResult
  | ScreenshotResult
  | TestCommandResult;

export function writeResult(
  result: CliResult,
  json: boolean,
  human: string,
  stdout: (text: string) => void,
  stderr: (text: string) => void,
): void {
  stdout(json ? `${JSON.stringify(result)}\n` : human);
  if (result.error) stderr(`${result.error.code}: ${result.error.message}\n`);
  if (
    result.cleanupError &&
    (result.cleanupError.code !== result.error?.code ||
      result.cleanupError.message !== result.error.message)
  ) {
    stderr(`${result.cleanupError.code}: ${result.cleanupError.message}\n`);
  }
}
