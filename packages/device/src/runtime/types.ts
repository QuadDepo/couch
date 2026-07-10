import type { RemoteKey, TVDevice } from "../types";

export type ProductPlatform = "android-tv" | "webos" | "philips-tv" | "tizen" | (string & {});
export type DriverId = "adb" | "lg-ssap" | (string & {});

export type OperationKind =
  | "control.press"
  | "control.text"
  | "device.wake"
  | "app.install"
  | "app.launch"
  | "app.stop"
  | "app.foreground"
  | "screen.capture"
  | "logs.capture";

export type Support = "stable" | "experimental" | "unsupported";
export type Readiness = "ready" | "missing-tool" | "unauthorized" | "offline" | "misconfigured";

export interface OperationCapability {
  support: Support;
  readiness: Readiness;
  reason?: string;
  constraints?: Record<string, string | number | boolean>;
}

export type DeviceOperation =
  | { kind: "control.press"; key: RemoteKey }
  | { kind: "control.text"; text: string }
  | { kind: "device.wake" }
  | { kind: "app.install"; artifact: string; appId?: string }
  | {
      kind: "app.launch";
      appId: string;
      activity?: string;
      params?: Record<string, unknown>;
    }
  | { kind: "app.stop"; appId: string }
  | { kind: "app.foreground"; appId: string }
  | { kind: "screen.capture"; format?: string; path?: string }
  | { kind: "logs.capture"; sinceMs?: number; path?: string };

export type Confirmation = "process-exit" | "protocol-response" | "transport-write";
export type OperationStatus = "succeeded" | "failed" | "cancelled";

export interface OperationError {
  code: string;
  category: "assertion" | "infrastructure" | "unsupported" | "cancelled";
  message: string;
  retryable: boolean;
}

export interface ArtifactReference {
  id?: string;
  path: string;
  type?: string;
  mimeType?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface OperationRecord {
  id: string;
  ordinal: number;
  kind: OperationKind;
  adapterId: DriverId;
  status: OperationStatus;
  confirmation?: Confirmation;
  startedAt: string;
  completedAt: string;
  input: Record<string, unknown>;
  error?: OperationError;
  artifacts: ArtifactReference[];
  metadata?: Record<string, unknown>;
}

export interface DeviceDescriptor {
  id: string;
  name: string;
  platform: ProductPlatform;
  ip: string;
  mac?: string;
  driverId?: DriverId;
  metadata?: Record<string, unknown>;
}

/** Internal inventory target. Credentials are deliberately not exposed by DeviceDescriptor. */
export interface RuntimeTarget extends DeviceDescriptor {
  source: TVDevice;
}

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
  createDriver: (device: RuntimeTarget) => DeviceDriver;
  getCapabilities: (
    device: RuntimeTarget,
    options?: { signal?: AbortSignal },
  ) =>
    | ReadonlyMap<OperationKind, OperationCapability>
    | Record<string, OperationCapability>
    | Promise<
        ReadonlyMap<OperationKind, OperationCapability> | Record<string, OperationCapability>
      >;
  lockResourceId?: (device: RuntimeTarget) => string;
}

export interface TargetRegistry {
  getRegistration(device: DeviceDescriptor): DriverRegistration | undefined;
}

export type InventoryLoader = () =>
  | Promise<readonly DeviceDescriptor[] | readonly TVDevice[] | null | undefined>
  | readonly DeviceDescriptor[]
  | readonly TVDevice[]
  | null
  | undefined;

export interface DiagnosticEvent {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  deviceId?: string;
  operationId?: string;
  metadata?: Record<string, unknown>;
  at: string;
}

export type DiagnosticSink =
  | ((event: DiagnosticEvent) => void | Promise<void>)
  | { emit: (event: DiagnosticEvent) => void | Promise<void> };

export interface DeviceRuntime {
  listDevices(options?: { signal?: AbortSignal }): Promise<readonly DeviceDescriptor[]>;
  getDevice(id: string, options?: { signal?: AbortSignal }): Promise<DeviceDescriptor>;
  getCapabilities(
    id: string,
    options?: { signal?: AbortSignal },
  ): Promise<ReadonlyMap<OperationKind, OperationCapability>>;
  openDevice(
    id: string,
    options: {
      require: readonly OperationKind[];
      signal?: AbortSignal;
      allowExperimental?: readonly OperationKind[];
    },
  ): Promise<DeviceHarness>;
}

export interface DeviceHarness {
  readonly capabilities: ReadonlyMap<OperationKind, OperationCapability>;
  execute(
    operation: DeviceOperation,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<OperationRecord>;
  close(): Promise<void>;
}

export interface DeviceRuntimeOptions {
  inventoryLoader?: InventoryLoader;
  registry?: TargetRegistry;
  lockDirectory?: string;
  diagnosticSink?: DiagnosticSink;
  runId?: string;
  closeTimeoutMs?: number;
}
