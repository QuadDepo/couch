import type { DiagnosticSink } from "../diagnostics/events";
import type { DriverRegistry } from "../drivers/types";
import type {
  DriverId,
  OperationCapability,
  OperationError,
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

export type PersistedDevice =
  | (PersistedDeviceBase & {
      platform: "android-tv";
      config?: Record<string, unknown>;
    })
  | (PersistedDeviceBase & {
      platform: "android-tv-remote";
      config?: { androidTvRemote: PersistedAndroidRemoteCredentials };
    })
  | (PersistedDeviceBase & {
      platform: "lg-webos";
      config?: { webos: PersistedWebOSCredentials };
    })
  | (PersistedDeviceBase & {
      platform: "philips-tv";
      config?: { philips: PersistedPhilipsCredentials };
    })
  | (PersistedDeviceBase & {
      platform: "samsung-tizen";
      config?: { tizen: PersistedTizenCredentials };
    });

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

export class DeviceInventoryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly category: OperationError["category"] = "infrastructure",
  ) {
    super(message);
    this.name = "DeviceInventoryError";
  }
}
