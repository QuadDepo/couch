import type { DeviceDoctorResult, DeviceListResult } from "./device/types";
import type { CommandError, CommandExitCode } from "./errors";
import type { PressResult } from "./remote/types";

export interface ResultBase {
  resultVersion: 1;
  status: string;
  exitCode: CommandExitCode;
  error?: CommandError;
  cleanupError?: CommandError;
}

export type CliResult = DeviceListResult | DeviceDoctorResult | PressResult;

export function writeResult(
  result: CliResult,
  json: boolean,
  human: string,
  stdout: (text: string) => void,
  stderr: (text: string) => void,
): void {
  stdout(json ? `${JSON.stringify(result)}\n` : human);
  if (result.error) stderr(`${result.error.code}: ${result.error.message}\n`);
  if (result.cleanupError) stderr(`${result.cleanupError.code}: ${result.cleanupError.message}\n`);
}
