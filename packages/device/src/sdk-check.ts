export interface SDKAvailability {
  adb: boolean;
  aresDevice: boolean;
  sdb: boolean;
}

async function isCommandAvailable(command: string): Promise<boolean> {
  try {
    const probeCommand = process.platform === "win32" ? "where" : "which";
    const proc = Bun.spawn([probeCommand, command], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
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
