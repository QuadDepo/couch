import type { AppCommandResult } from "./app/types";
import type { DeviceDoctorResult, DeviceListResult } from "./device/types";
import type { CommandError, CommandExitCode } from "./errors";
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
