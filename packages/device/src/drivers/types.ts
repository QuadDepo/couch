import type { InventoryTarget } from "../inventory/types";
import type {
  ArtifactReference,
  Confirmation,
  DeviceOperation,
  DriverId,
  OperationCapability,
  OperationKind,
  ProductPlatform,
} from "../operations/types";

export interface DriverReceipt {
  confirmation: Confirmation;
  artifacts?: readonly ArtifactReference[];
  metadata?: Record<string, unknown>;
}

export interface DeviceDriver {
  readonly adapterId: DriverId;
  open(options?: { signal?: AbortSignal }): Promise<void> | void;
  execute(
    operation: DeviceOperation,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<DriverReceipt>;
  isReady(): Promise<boolean> | boolean;
  close(): Promise<void> | void;
}

export interface DriverRegistration {
  driverId: DriverId;
  platform: ProductPlatform;
  createDriver: (device: InventoryTarget) => DeviceDriver;
  getCapabilities: (
    device: InventoryTarget,
    options?: { signal?: AbortSignal },
  ) =>
    | ReadonlyMap<OperationKind, OperationCapability>
    | Record<string, OperationCapability>
    | Promise<
        ReadonlyMap<OperationKind, OperationCapability> | Record<string, OperationCapability>
      >;
  lockResourceId?: (device: InventoryTarget) => string;
}

export interface DriverRegistry {
  getRegistration(device: {
    driverId?: DriverId;
    platform: ProductPlatform;
  }): DriverRegistration | undefined;
}
