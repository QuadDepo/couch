import type { DeviceInventory } from "@couch/device";
import { errorDetails, FAILURE_EXIT, UsageError } from "../errors";
import type { SignalControl } from "../processSignals";
import type { DeviceListResult, ParsedList } from "./types";

export function parseList(args: readonly string[]): ParsedList {
  let json = false;
  for (const argument of args) {
    if (argument === "--json" && !json) {
      json = true;
      continue;
    }
    if (argument === "--json") throw new UsageError("--json may only be specified once");
    throw new UsageError(`unknown option: ${argument}`);
  }
  return { command: "device.list", json };
}

export async function runList(
  getInventory: () => Promise<DeviceInventory>,
  signals: SignalControl,
): Promise<DeviceListResult> {
  try {
    const inventory = await getInventory();
    const devices = [...(await inventory.listDevices({ signal: signals.signal }))].sort(
      (left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
    if (signals.exitCode) return cancelledList(signals);
    return { resultVersion: 1, command: "device.list", status: "succeeded", exitCode: 0, devices };
  } catch (error) {
    if (signals.exitCode) return cancelledList(signals);
    return {
      resultVersion: 1,
      command: "device.list",
      status: "failed",
      exitCode: FAILURE_EXIT,
      error: errorDetails(error),
      devices: [],
    };
  }
}

function cancelledList(signals: SignalControl): DeviceListResult {
  return {
    resultVersion: 1,
    command: "device.list",
    status: "cancelled",
    exitCode: signals.exitCode ?? 130,
    error: { code: "cancelled", message: signals.message ?? "Interrupted" },
    devices: [],
  };
}

export function humanList(result: DeviceListResult): string {
  if (result.status !== "succeeded") return `device.list: ${result.status}\n`;
  if (result.devices.length === 0) return "No devices found.\n";
  const rows = result.devices.map((device) =>
    [device.id, device.name, device.platform, device.driverId ?? "-", device.ip].join("\t"),
  );
  return `${["ID\tNAME\tPLATFORM\tDRIVER\tADDRESS", ...rows].join("\n")}\n`;
}
