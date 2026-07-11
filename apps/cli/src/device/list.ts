import type { DeviceInventory } from "@couch/device";
import { cancelledFields, failedFields } from "../commandOutput";
import { errorDetails } from "../errors";
import { parseOptions } from "../parseOptions";
import type { SignalControl } from "../processSignals";
import type { DeviceListResult, ParsedList } from "./types";

export function parseList(args: readonly string[]): ParsedList {
  const { json } = parseOptions(args, 0);
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
      devices: [],
      ...failedFields(errorDetails(error)),
    };
  }
}

function cancelledList(signals: SignalControl): DeviceListResult {
  return {
    resultVersion: 1,
    command: "device.list",
    devices: [],
    ...cancelledFields(signals),
  };
}

export function formatListResult(result: DeviceListResult): string {
  if (result.status !== "succeeded") return `device.list: ${result.status}\n`;
  if (result.devices.length === 0) return "No devices found.\n";
  const rows = result.devices.map((device) =>
    [device.id, device.name, device.platform, device.driverId ?? "-", device.ip].join("\t"),
  );
  return `${["ID\tNAME\tPLATFORM\tDRIVER\tADDRESS", ...rows].join("\n")}\n`;
}
