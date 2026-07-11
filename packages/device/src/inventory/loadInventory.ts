import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { TVDevice } from "../types";
import { atomicWrite } from "../utils/atomicWrite";
import { logger } from "../utils/logger";
import { InventoryError, parseStorage, serializeDevice } from "./inventorySchema";
import type { PersistedDevice } from "./types";

const DEVICES_FILE = join(homedir(), ".couch", "devices.json");

export async function loadDevicesFromFile(filePath: string): Promise<PersistedDevice[] | null> {
  let raw: unknown;
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) return null;
    raw = await file.json();
  } catch (error) {
    throw new InventoryError("IO_ERROR", `Failed to read inventory file: ${filePath}`, {
      cause: error,
    });
  }
  return parseStorage(raw).devices;
}

export async function saveDevicesToFile(filePath: string, devices: TVDevice[]): Promise<void> {
  let data: { version: 1; devices: ReturnType<typeof serializeDevice>[] };
  try {
    data = { version: 1, devices: devices.map(serializeDevice) };
    parseStorage(data);
  } catch (error) {
    if (error instanceof InventoryError) throw error;
    throw new InventoryError("INVALID_SCHEMA", "Invalid devices to save", { cause: error });
  }
  try {
    await mkdir(dirname(filePath), { recursive: true });
    await chmod(dirname(filePath), 0o700);
    await atomicWrite(filePath, new TextEncoder().encode(JSON.stringify(data, null, 2)));
  } catch (error) {
    throw new InventoryError("IO_ERROR", `Failed to save inventory file: ${filePath}`, {
      cause: error,
    });
  }
  logger.info("Storage", `Saved ${devices.length} device(s)`);
}

export function loadDevices(): Promise<PersistedDevice[] | null> {
  return loadDevicesFromFile(DEVICES_FILE);
}

export function saveDevices(devices: TVDevice[]): Promise<void> {
  return saveDevicesToFile(DEVICES_FILE, devices);
}
