import type { DiagnosticSink } from "../diagnostics/events";
import type { DeviceDriver } from "../drivers/types";
import type {
  DeviceOperation,
  OperationCapability,
  OperationKind,
  OperationRecord,
} from "../operations/types";
import type { ExecuteOptions } from "./deviceSession";

export interface PendingOperation extends ExecuteOptions {
  operation: DeviceOperation;
  ordinal: number;
  resolve: (record: OperationRecord) => void;
  cancelled: boolean;
  settled: boolean;
  cancelReason?: unknown;
  onAbort?: () => void;
  cancelPromise: Promise<void>;
  cancelResolve: () => void;
}

export interface QueueDependencies {
  driver: DeviceDriver;
  capabilities: ReadonlyMap<OperationKind, OperationCapability>;
  sink?: DiagnosticSink;
  deviceId: string;
  allowExperimental: readonly OperationKind[];
  requestClose: () => void;
}
