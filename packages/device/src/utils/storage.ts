import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import * as v from "valibot";
import { type ImplementedPlatform, platformRegistry } from "../devices/registry";
import type { TVDevice, TVPlatform } from "../types";
import { logger } from "./logger";
import { isValidIp } from "./network";

const CONFIG_DIR = join(homedir(), ".couch");
const DEVICES_FILE = join(CONFIG_DIR, "devices.json");

export interface PersistedDevice {
  id: string;
  name: string;
  platform: TVPlatform;
  ip: string;
  mac?: string;
  config?: TVDevice["config"];
}

export interface StorageSchema {
  version: 1;
  devices: PersistedDevice[];
}

export type InventoryErrorCode = "INVALID_SCHEMA" | "UNSUPPORTED_VERSION" | "IO_ERROR";

export class InventoryError extends Error {
  readonly code: InventoryErrorCode;

  constructor(code: InventoryErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InventoryError";
    this.code = code;
  }
}

const PLATFORMS = Object.keys(platformRegistry) as [ImplementedPlatform, ...ImplementedPlatform[]];
const STORAGE_SCHEMA = v.object({
  version: v.unknown(),
  devices: v.array(v.unknown()),
});
const PERSISTED_DEVICE = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  name: v.pipe(v.string(), v.minLength(1)),
  platform: v.picklist(PLATFORMS),
  ip: v.pipe(v.string(), v.minLength(1)),
  mac: v.optional(v.string()),
  config: v.optional(v.unknown()),
});

const CONFIG_KEYS: Partial<Record<ImplementedPlatform, string>> = {
  "lg-webos": "webos",
  "android-tv-remote": "androidTvRemote",
  "philips-tv": "philips",
  "samsung-tizen": "tizen",
};

function invalidSchema(message: string, cause?: unknown): InventoryError {
  return new InventoryError("INVALID_SCHEMA", message, { cause });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateConfig(platform: ImplementedPlatform, config: unknown): TVDevice["config"] {
  if (config === undefined) {
    return undefined;
  }
  if (!isRecord(config)) {
    throw invalidSchema(`Invalid config for platform ${platform}`);
  }

  const configKey = CONFIG_KEYS[platform];
  if (!configKey) {
    return config as TVDevice["config"];
  }
  const keys = Object.keys(config);
  if (keys.length !== 1 || keys[0] !== configKey) {
    throw invalidSchema(`Invalid config for platform ${platform}`);
  }

  try {
    platformRegistry[platform].wrapCredentials(config[configKey]);
  } catch (error) {
    throw invalidSchema(`Invalid credentials for platform ${platform}`, error);
  }

  return config as TVDevice["config"];
}

function parsePersistedDevice(value: unknown, index: number): PersistedDevice {
  const result = v.safeParse(PERSISTED_DEVICE, value);
  if (!result.success) {
    throw invalidSchema(`Invalid device at index ${index}`, result.issues);
  }
  if (!isValidIp(result.output.ip)) {
    throw invalidSchema(`Invalid IP address for device at index ${index}`);
  }

  const config = validateConfig(result.output.platform, result.output.config);
  const device: Omit<PersistedDevice, "config"> = {
    id: result.output.id,
    name: result.output.name,
    platform: result.output.platform,
    ip: result.output.ip,
    ...(result.output.mac === undefined ? {} : { mac: result.output.mac }),
  };
  return {
    ...device,
    ...(config === undefined ? {} : { config }),
  };
}

function parseStorage(value: unknown): StorageSchema {
  const result = v.safeParse(STORAGE_SCHEMA, value);
  if (!result.success) {
    throw invalidSchema("Invalid inventory schema", result.issues);
  }
  if (result.output.version !== 1) {
    throw new InventoryError(
      "UNSUPPORTED_VERSION",
      `Unsupported inventory schema version: ${String(result.output.version)}`,
    );
  }

  return {
    version: 1,
    devices: result.output.devices.map(parsePersistedDevice),
  };
}

async function ensureConfigDir(configDir: string): Promise<void> {
  await mkdir(configDir, { recursive: true });
  await chmod(configDir, 0o700);
}

function toPersistedDevice({ id, name, platform, ip, mac, config }: TVDevice): PersistedDevice {
  return {
    id,
    name,
    platform,
    ip,
    ...(mac && { mac }),
    ...(config && { config }),
  };
}

export async function loadDevicesFromFile(filePath: string): Promise<TVDevice[] | null> {
  let raw: unknown;
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return null;
    }
    raw = await file.json();
  } catch (error) {
    throw new InventoryError("IO_ERROR", `Failed to read inventory file: ${filePath}`, {
      cause: error,
    });
  }

  const data = parseStorage(raw);
  return data.devices.map((device) => ({
    ...device,
    status: "disconnected" as const,
  }));
}

export async function saveDevicesToFile(filePath: string, devices: TVDevice[]): Promise<void> {
  let data: StorageSchema;
  try {
    data = {
      version: 1,
      devices: devices.map(toPersistedDevice),
    };
    parseStorage(data);
  } catch (error) {
    if (error instanceof InventoryError) throw error;
    throw new InventoryError("INVALID_SCHEMA", "Invalid devices to save", { cause: error });
  }

  try {
    await ensureConfigDir(dirname(filePath));
    await Bun.write(filePath, JSON.stringify(data, null, 2));
    await chmod(filePath, 0o600);
  } catch (error) {
    throw new InventoryError("IO_ERROR", `Failed to save inventory file: ${filePath}`, {
      cause: error,
    });
  }
  logger.info("Storage", `Saved ${devices.length} device(s)`);
}

export function loadDevices(): Promise<TVDevice[] | null> {
  return loadDevicesFromFile(DEVICES_FILE);
}

export function saveDevices(devices: TVDevice[]): Promise<void> {
  return saveDevicesToFile(DEVICES_FILE, devices);
}
