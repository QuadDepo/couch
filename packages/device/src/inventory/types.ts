import type { DiagnosticSink } from "../diagnostics/events";
import type { DriverRegistry } from "../drivers/types";
import type {
  DriverId,
  OperationCapability,
  OperationKind,
  ProductPlatform,
} from "../operations/types";
import type { DeviceSession } from "../sessions/deviceSession";
import type {
  PersistedAndroidRemoteCredentials,
  PersistedPhilipsCredentials,
  PersistedTizenCredentials,
  PersistedWebOSCredentials,
} from "./persistedCredentials";

interface PersistedDeviceBase {
  id: string;
  name: string;
  ip: string;
  mac?: string;
}

// The stored config key per platform mirrors TVDevice's PlatformConfig, but over the looser
// persisted credential types (unknown keys allowed, no injected defaults).
interface PersistedConfigByPlatform {
  "android-tv": Record<string, unknown>;
  "android-tv-remote": { androidTvRemote: PersistedAndroidRemoteCredentials };
  "lg-webos": { webos: PersistedWebOSCredentials };
  "philips-tv": { philips: PersistedPhilipsCredentials };
  "samsung-tizen": { tizen: PersistedTizenCredentials };
}

export type PersistedDevice = {
  [P in keyof PersistedConfigByPlatform]: PersistedDeviceBase & {
    platform: P;
    config?: PersistedConfigByPlatform[P];
  };
}[keyof PersistedConfigByPlatform];

export interface DeviceDescriptor {
  id: string;
  name: string;
  platform: ProductPlatform;
  ip: string;
  mac?: string;
  driverId?: DriverId;
}

export interface InventoryTarget extends DeviceDescriptor {
  source: PersistedDevice;
}

export type InventoryLoader = () =>
  | Promise<readonly PersistedDevice[] | null | undefined>
  | readonly PersistedDevice[]
  | null
  | undefined;

export interface QueryOptions {
  signal?: AbortSignal;
}

export interface OpenSessionOptions extends QueryOptions {
  require: readonly OperationKind[];
  allowExperimental?: readonly OperationKind[];
}

export interface DeviceInventory {
  listDevices(options?: QueryOptions): Promise<readonly DeviceDescriptor[]>;
  getDevice(id: string, options?: QueryOptions): Promise<DeviceDescriptor>;
  getCapabilities(
    id: string,
    options?: QueryOptions,
  ): Promise<ReadonlyMap<OperationKind, OperationCapability>>;
  openSession(id: string, options: OpenSessionOptions): Promise<DeviceSession>;
}

export interface DeviceInventoryOptions {
  inventoryLoader?: InventoryLoader;
  registry?: DriverRegistry;
  lockDirectory?: string;
  diagnosticSink?: DiagnosticSink;
  runId?: string;
  closeTimeoutMs?: number;
}

export { DeviceInventoryError, type DeviceInventoryErrorCode } from "../errors";
