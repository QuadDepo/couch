import { execFile } from "node:child_process";
import { promisify } from "node:util";

export interface SDKAvailability {
  adb: boolean;
  aresDevice: boolean;
  sdb: boolean;
}

const execFileAsync = promisify(execFile);

async function isCommandAvailable(command: string): Promise<boolean> {
  try {
    const probeCommand = process.platform === "win32" ? "where" : "which";
    await execFileAsync(probeCommand, [command]);
    return true;
  } catch {
    return false;
  }
}

export async function checkSDKAvailability(): Promise<SDKAvailability> {
  const [adb, aresDevice, sdb] = await Promise.all([
    isCommandAvailable("adb"),
    isCommandAvailable("ares-device"),
    isCommandAvailable("sdb"),
  ]);

  return { adb, aresDevice, sdb };
}
