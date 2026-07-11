import * as v from "valibot";
import type { ImplementedPlatform } from "../devices/registry";
import type { TVDevice } from "../types";
import { isValidIp } from "../utils/network";
import { isRecord } from "../utils/validation";
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

// Turn the first Valibot issue into a "field: reason" string so file-parse errors name the
// failing field and its expected type rather than a generic "invalid schema".
function formatFirstIssue(issues: readonly v.BaseIssue<unknown>[]): string {
  const [issue] = issues;
  if (!issue) return "unknown validation error";
  const path = issue.path?.map((segment) => String(segment.key)).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

function configRecord(platform: ImplementedPlatform, config: unknown): Record<string, unknown> {
  if (!isRecord(config)) {
    throw invalidSchema(`Config for platform ${platform} must be an object`);
  }
  return config;
}

function credentialValue(platform: ImplementedPlatform, config: unknown, key: string): unknown {
  const record = configRecord(platform, config);
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== key) {
    const found = keys.length === 0 ? "no keys" : keys.map((key) => `"${key}"`).join(", ");
    throw invalidSchema(
      `Config for platform ${platform} must contain only "${key}", but found: ${found}`,
    );
  }
  return record[key];
}

// The per-platform credential config: each of these platforms stores its credentials under a
// single named key that is parsed by the matching persisted-credentials parser. "android-tv"
// is absent because it stores an arbitrary config record with no credential key.
const CREDENTIAL_CONFIG: Record<
  Exclude<ImplementedPlatform, "android-tv">,
  { key: string; parse: (value: unknown) => unknown }
> = {
  "lg-webos": { key: "webos", parse: parsePersistedWebOSCredentials },
  "android-tv-remote": { key: "androidTvRemote", parse: parsePersistedAndroidRemoteCredentials },
  "philips-tv": { key: "philips", parse: parsePersistedPhilipsCredentials },
  "samsung-tizen": { key: "tizen", parse: parsePersistedTizenCredentials },
};

// Parse a single-credential-key config fragment; returns an empty fragment when no config is
// stored so the caller can spread it unconditionally.
function optionalCredentialConfig<K extends string, T>(
  platform: ImplementedPlatform,
  config: unknown,
  key: K,
  parse: (value: unknown) => T,
): Record<string, never> | { config: Record<K, T> } {
  if (config === undefined) return {};
  return { config: { [key]: parse(credentialValue(platform, config, key)) } as Record<K, T> };
}

function parseDevice(value: unknown, index: number): PersistedDevice {
  const result = v.safeParse(PERSISTED_DEVICE, value);
  if (!result.success) {
    throw invalidSchema(
      `Invalid device at index ${index}: ${formatFirstIssue(result.issues)}`,
      result.issues,
    );
  }
  if (!isValidIp(result.output.ip)) {
    throw invalidSchema(`Invalid IP address for device at index ${index}`);
  }
  const { id, name, ip, mac, config } = result.output;
  const platform = result.output.platform;
  const fields = { id, name, ip, ...(mac === undefined ? {} : { mac }) };
  try {
    if (platform === "android-tv") {
      return {
        ...fields,
        platform,
        ...(config === undefined ? {} : { config: configRecord("android-tv", config) }),
      };
    }
    const { key, parse } = CREDENTIAL_CONFIG[platform];
    return {
      ...fields,
      platform,
      ...optionalCredentialConfig(platform, config, key, parse),
    } as PersistedDevice;
  } catch (error) {
    if (error instanceof InventoryError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw invalidSchema(`Invalid credentials for platform ${platform}: ${detail}`, error);
  }
}

export function parseStorage(value: unknown): StorageSchema {
  const result = v.safeParse(STORAGE_SCHEMA, value);
  if (!result.success) {
    throw invalidSchema(
      `Invalid inventory schema: ${formatFirstIssue(result.issues)}`,
      result.issues,
    );
  }
  if (result.output.version !== 1) {
    throw new InventoryError(
      "UNSUPPORTED_VERSION",
      `Unsupported inventory schema version: ${String(result.output.version)}`,
    );
  }
  return { version: 1, devices: result.output.devices.map(parseDevice) };
}

export function serializeDevice(device: TVDevice) {
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
