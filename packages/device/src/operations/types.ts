import type { RemoteKey } from "../types";

export type ProductPlatform = "android-tv" | "webos" | "philips-tv" | "tizen" | (string & {});
export type DriverId = "adb" | "lg-ssap" | (string & {});

export const OPERATION_KINDS = [
  "control.press",
  "control.text",
  "device.wake",
  "app.install",
  "app.launch",
  "app.stop",
  "app.foreground",
  "screen.capture",
  "logs.capture",
] as const;

export type OperationKind = (typeof OPERATION_KINDS)[number];

const OPERATION_KIND_SET: ReadonlySet<string> = new Set(OPERATION_KINDS);

export function isOperationKind(value: string): value is OperationKind {
  return OPERATION_KIND_SET.has(value);
}

export type DeviceOperation =
  | { kind: "control.press"; key: RemoteKey }
  | { kind: "control.text"; text: string }
  | { kind: "device.wake" }
  | { kind: "app.install"; artifact: string; appId?: string }
  | { kind: "app.launch"; appId: string; activity?: string; params?: Record<string, unknown> }
  | { kind: "app.stop"; appId: string }
  | { kind: "app.foreground"; appId: string }
  | { kind: "screen.capture"; format?: string; path?: string }
  | { kind: "logs.capture"; sinceMs?: number; path?: string };

export type Support = "stable" | "experimental" | "unsupported";
export type Readiness = "ready" | "missing-tool" | "unauthorized" | "offline" | "misconfigured";
export type Confirmation = "process-exit" | "protocol-response" | "transport-write";
export type OperationStatus = "succeeded" | "failed" | "cancelled";

export interface OperationCapability {
  support: Support;
  readiness: Readiness;
  reason?: string;
  constraints?: Record<string, string | number | boolean>;
}

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
