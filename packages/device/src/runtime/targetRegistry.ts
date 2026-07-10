import type { AndroidTvDriverDependencies } from "../devices/android-tv/driver";
import { createAndroidTvDriver, probeAndroidTv } from "../devices/android-tv/driver";
import { createLgWebosDriver } from "../devices/lg-webos/driver";
import type {
  DriverRegistration,
  OperationCapability,
  OperationKind,
  RuntimeTarget,
  TargetRegistry,
} from "./types";

const stable = (): OperationCapability => ({ support: "stable", readiness: "ready" });
function capabilities(
  entries: readonly [OperationKind, OperationCapability][],
): ReadonlyMap<OperationKind, OperationCapability> {
  return new Map(entries);
}

const androidCapabilities = capabilities([
  ["control.press", stable()],
  ["control.text", stable()],
  ["device.wake", stable()],
]);

async function androidCapabilitiesFor(
  target: RuntimeTarget,
  dependencies: AndroidTvDriverDependencies,
  options: { signal?: AbortSignal } = {},
): Promise<ReadonlyMap<OperationKind, OperationCapability>> {
  const readiness = await probeAndroidTv({ ip: target.ip }, dependencies, options);
  if (readiness === "ready") return androidCapabilities;
  return new Map(
    [...androidCapabilities].map(([kind, capability]) => [
      kind,
      {
        ...capability,
        readiness,
        reason: `ADB is ${readiness} for ${target.ip}`,
      },
    ]),
  );
}

const webosCapabilities = capabilities([
  ["control.press", stable()],
  ["control.text", stable()],
]);

function webosCapabilitiesFor(
  target: RuntimeTarget,
): ReadonlyMap<OperationKind, OperationCapability> {
  const config = targetConfig(target);
  const credentials = config?.webos as { clientKey?: unknown } | undefined;
  if (credentials?.clientKey) return webosCapabilities;
  return new Map(
    [...webosCapabilities].map(([kind, capability]) => [
      kind,
      {
        ...capability,
        readiness: "misconfigured" as const,
        reason: "LG webOS requires a paired client key",
      },
    ]),
  );
}

function targetConfig(target: RuntimeTarget): Record<string, unknown> | undefined {
  return target.source.config as Record<string, unknown> | undefined;
}

function builtInRegistrations(
  androidTvDependencies: AndroidTvDriverDependencies = {},
): readonly DriverRegistration[] {
  return [
    {
      driverId: "adb",
      platform: "android-tv",
      createDriver: (target) => createAndroidTvDriver({ ip: target.ip }, androidTvDependencies),
      getCapabilities: (target, options) =>
        androidCapabilitiesFor(target, androidTvDependencies, options),
      lockResourceId: (target) => `adb:${target.ip}:5555`,
    },
    {
      driverId: "lg-ssap",
      platform: "webos",
      createDriver: (target) => {
        const config = targetConfig(target);
        const credentials = config?.webos;
        return createLgWebosDriver({
          ip: target.ip,
          credentials: credentials as Parameters<typeof createLgWebosDriver>[0]["credentials"],
        });
      },
      getCapabilities: (target) => webosCapabilitiesFor(target),
      lockResourceId: (target) => `device:${target.id}`,
    },
  ];
}

export interface TargetRegistryOptions {
  registrations?: readonly DriverRegistration[];
  androidTvDependencies?: AndroidTvDriverDependencies;
}

export function createTargetRegistry(options: TargetRegistryOptions = {}): TargetRegistry {
  const registrations =
    options.registrations ?? builtInRegistrations(options.androidTvDependencies);
  const byDriver = new Map(
    registrations.map((registration) => [registration.driverId, registration]),
  );
  return {
    getRegistration(device) {
      if (device.driverId) return byDriver.get(device.driverId);
      const fallbackDriver =
        device.platform === "android-tv"
          ? "adb"
          : device.platform === "webos"
            ? "lg-ssap"
            : undefined;
      return fallbackDriver ? byDriver.get(fallbackDriver) : undefined;
    },
  };
}

export function getLockResourceId(
  device: RuntimeTarget,
  registration?: DriverRegistration,
): string {
  if (registration?.lockResourceId) return registration.lockResourceId(device);
  if (device.platform === "android-tv") return `adb:${device.ip}:5555`;
  return `device:${device.id}`;
}
