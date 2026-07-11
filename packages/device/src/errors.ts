import type { OperationError } from "./operations/types";

export type DeviceInventoryErrorCode =
  | "DEVICE_NOT_FOUND"
  | "DRIVER_NOT_FOUND"
  | "DRIVER_NOT_READY"
  | "UNSUPPORTED_OPERATION"
  | "EXPERIMENTAL_OPERATION";

export class DeviceInventoryError extends Error {
  constructor(
    readonly code: DeviceInventoryErrorCode,
    message: string,
    readonly category: OperationError["category"] = "infrastructure",
  ) {
    super(message);
    this.name = "DeviceInventoryError";
  }
}
