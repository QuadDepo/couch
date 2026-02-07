import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TVDevice, TVPlatform } from "../types";
import { logger } from "./logger";

const CONFIG_DIR = join(homedir(), ".couch");
const DEVICES_FILE = join(CONFIG_DIR, "devices.json");

interface PersistedDevice {
  id: string;
  name: string;
  platform: TVPlatform;
  ip: string;
  mac?: string;
  config?: TVDevice["config"];
}

interface StorageSchema {
  version: number;
  devices: PersistedDevice[];
}

async function ensureConfigDir(): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
}

export async function loadDevices(): Promise<TVDevice[] | null> {
  try {
    const file = Bun.file(DEVICES_FILE);
    if (!(await file.exists())) {
      return null;
    }

    const data: StorageSchema = await file.json();

    if (!data.devices || !Array.isArray(data.devices)) {
      logger.warn("Storage", "Invalid storage format");
      return null;
    }

    return data.devices.map((d) => ({
      ...d,
      status: "disconnected" as const,
    }));
  } catch (error) {
    logger.warn("Storage", `Failed to load devices: ${error}`);
    return null;
  }
}

export async function saveDevices(devices: TVDevice[]): Promise<void> {
  try {
    await ensureConfigDir();

    const persistedDevices: PersistedDevice[] = devices.map(
      ({ id, name, platform, ip, mac, config }) => ({
        id,
        name,
        platform,
        ip,
        ...(mac && { mac }),
        ...(config && { config }),
      }),
    );

    const data: StorageSchema = {
      version: 1,
      devices: persistedDevices,
    };

    await Bun.write(DEVICES_FILE, JSON.stringify(data, null, 2));
    logger.info("Storage", `Saved ${devices.length} device(s)`);
  } catch (error) {
    logger.warn("Storage", `Failed to save devices: ${error}`);
  }
}
