import type { DeviceDescriptor, OperationCapability, OperationKind } from "@couch/device";
import type { ResultBase } from "../commandOutput";

export interface ParsedList {
  command: "device.list";
  json: boolean;
}

export interface ParsedDoctor {
  command: "device.doctor";
  targetId: string;
  json: boolean;
}

export interface DeviceListResult extends ResultBase {
  command: "device.list";
  status: "succeeded" | "failed" | "cancelled";
  devices: readonly DeviceDescriptor[];
}

export interface DoctorCapability extends OperationCapability {
  kind: OperationKind;
  remediation: string;
}

export interface DeviceDoctorResult extends ResultBase {
  command: "device.doctor";
  targetId: string;
  status: "ready" | "unverified" | "not-ready" | "failed" | "cancelled";
  readinessScope: "live" | "configuration-only" | "unknown";
  target?: DeviceDescriptor;
  capabilities: readonly DoctorCapability[];
}
