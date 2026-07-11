import type { AndroidTvDriverDependencies } from "../devices/android-tv/driver";
import { createAndroidTvDriver, probeAndroidTv } from "../devices/android-tv/driver";
import type { InventoryTarget } from "../inventory/types";
import type { OperationCapability, OperationKind } from "../operations/types";
import type { DriverRegistration } from "./types";

const capabilities = new Map<OperationKind, OperationCapability>([
  ["control.press", stableCapability()],
  ["control.text", stableCapability()],
  ["device.wake", stableCapability()],
  ["app.launch", stableCapability({ activityRequired: true })],
  ["app.stop", stableCapability()],
  ["app.foreground", stableCapability()],
  ["screen.capture", stableCapability({ format: "png", transport: "adb-exec-out" })],
]);

function stableCapability(
  constraints: Record<string, string | number | boolean> = {},
): OperationCapability {
  return {
    support: "stable",
    readiness: "ready",
    constraints: { readinessCheck: "live-adb-probe", ...constraints },
  };
}

async function getCapabilities(
  target: InventoryTarget,
  dependencies: AndroidTvDriverDependencies,
  options: { signal?: AbortSignal } = {},
): Promise<ReadonlyMap<OperationKind, OperationCapability>> {
  const readiness = await probeAndroidTv({ ip: target.ip }, dependencies, options);
  if (readiness === "ready") return capabilities;
  return new Map(
    [...capabilities].map(([kind, capability]) => [
      kind,
      { ...capability, readiness, reason: `ADB is ${readiness} for ${target.ip}` },
    ]),
  );
}

export function createAndroidRegistration(
  dependencies: AndroidTvDriverDependencies = {},
): DriverRegistration {
  return {
    driverId: "adb",
    createDriver: (target) => createAndroidTvDriver({ ip: target.ip }, dependencies),
    getCapabilities: (target, options) => getCapabilities(target, dependencies, options),
  };
}
