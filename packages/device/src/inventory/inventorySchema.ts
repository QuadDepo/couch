import * as v from "valibot";
import type { ImplementedPlatform } from "../devices/registry";
import type { TVDevice, TVPlatform } from "../types";
import { isValidIp } from "../utils/network";
import {
  parsePersistedAndroidRemoteCredentials,
  parsePersistedPhilipsCredentials,
  parsePersistedTizenCredentials,
  parsePersistedWebOSCredentials,
} from "./persistedCredentials";
import type { PersistedDevice } from "./types";

export interface StorageSchema {
  version: 1;
  devices: PersistedDevice[];
}

export type InventoryErrorCode = "INVALID_SCHEMA" | "UNSUPPORTED_VERSION" | "IO_ERROR";

export class InventoryError extends Error {
  constructor(
    readonly code: InventoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "InventoryError";
  }
}

const PLATFORMS = [
  "lg-webos",
  "android-tv",
  "philips-tv",
  "samsung-tizen",
  "android-tv-remote",
] as const satisfies readonly ImplementedPlatform[];
const STORAGE_SCHEMA = v.object({ version: v.unknown(), devices: v.array(v.unknown()) });
const PERSISTED_DEVICE = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  name: v.pipe(v.string(), v.minLength(1)),
  platform: v.picklist(PLATFORMS),
  ip: v.pipe(v.string(), v.minLength(1)),
  mac: v.optional(v.string()),
  config: v.optional(v.unknown()),
});

function invalidSchema(message: string, cause?: unknown): InventoryError {
  return new InventoryError("INVALID_SCHEMA", message, { cause });
}

function configRecord(platform: ImplementedPlatform, config: unknown): Record<string, unknown> {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw invalidSchema(`Invalid config for platform ${platform}`);
  }
  return Object.fromEntries(Object.entries(config));
}

function credentialValue(platform: ImplementedPlatform, config: unknown, key: string): unknown {
  const record = configRecord(platform, config);
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== key) {
    throw invalidSchema(`Invalid config for platform ${platform}`);
  }
  return record[key];
}

function parseDevice(value: unknown, index: number): PersistedDevice {
  const result = v.safeParse(PERSISTED_DEVICE, value);
  if (!result.success) throw invalidSchema(`Invalid device at index ${index}`, result.issues);
  if (!isValidIp(result.output.ip)) {
    throw invalidSchema(`Invalid IP address for device at index ${index}`);
  }
  const { id, name, ip, mac, config } = result.output;
  const fields = { id, name, ip, ...(mac === undefined ? {} : { mac }) };
  try {
    switch (result.output.platform) {
      case "android-tv":
        return {
          ...fields,
          platform: "android-tv",
          ...(config === undefined ? {} : { config: configRecord("android-tv", config) }),
        };
      case "lg-webos":
        return {
          ...fields,
          platform: "lg-webos",
          ...(config === undefined
            ? {}
            : {
                config: {
                  webos: parsePersistedWebOSCredentials(
                    credentialValue("lg-webos", config, "webos"),
                  ),
                },
              }),
        };
      case "android-tv-remote":
        return {
          ...fields,
          platform: "android-tv-remote",
          ...(config === undefined
            ? {}
            : {
                config: {
                  androidTvRemote: parsePersistedAndroidRemoteCredentials(
                    credentialValue("android-tv-remote", config, "androidTvRemote"),
                  ),
                },
              }),
        };
      case "philips-tv":
        return {
          ...fields,
          platform: "philips-tv",
          ...(config === undefined
            ? {}
            : {
                config: {
                  philips: parsePersistedPhilipsCredentials(
                    credentialValue("philips-tv", config, "philips"),
                  ),
                },
              }),
        };
      case "samsung-tizen":
        return {
          ...fields,
          platform: "samsung-tizen",
          ...(config === undefined
            ? {}
            : {
                config: {
                  tizen: parsePersistedTizenCredentials(
                    credentialValue("samsung-tizen", config, "tizen"),
                  ),
                },
              }),
        };
    }
  } catch (error) {
    if (error instanceof InventoryError) throw error;
    throw invalidSchema(`Invalid credentials for platform ${result.output.platform}`, error);
  }
}

export function parseStorage(value: unknown): StorageSchema {
  const result = v.safeParse(STORAGE_SCHEMA, value);
  if (!result.success) throw invalidSchema("Invalid inventory schema", result.issues);
  if (result.output.version !== 1) {
    throw new InventoryError(
      "UNSUPPORTED_VERSION",
      `Unsupported inventory schema version: ${String(result.output.version)}`,
    );
  }
  return { version: 1, devices: result.output.devices.map(parseDevice) };
}

interface SerializedDevice {
  id: string;
  name: string;
  platform: TVPlatform;
  ip: string;
  mac?: string;
  config?: TVDevice["config"];
}

export function serializeDevice(device: TVDevice): SerializedDevice {
  const { id, name, platform, ip, mac, config } = device;
  return {
    id,
    name,
    platform,
    ip,
    ...(mac ? { mac } : {}),
    ...(config ? { config } : {}),
  };
}
