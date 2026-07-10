import { validateWebOSCredentials } from "../devices/lg-webos/credentials";
import { createLgWebosDriver } from "../devices/lg-webos/driver";
import type { InventoryTarget, PersistedDevice } from "../inventory/types";
import type { OperationCapability, OperationKind } from "../operations/types";
import type { DriverRegistration } from "./types";

const capabilities = new Map<OperationKind, OperationCapability>([
  ["control.press", stableCapability()],
  ["control.text", stableCapability()],
]);

function stableCapability(): OperationCapability {
  return {
    support: "stable",
    readiness: "ready",
    constraints: { readinessCheck: "paired-configuration-only" },
  };
}

function webosSource(target: InventoryTarget): Extract<PersistedDevice, { platform: "lg-webos" }> {
  if (target.source.platform !== "lg-webos") {
    throw new Error(`Expected an LG webOS device, received ${target.source.platform}`);
  }
  return target.source;
}

function webosCredentials(target: InventoryTarget) {
  const credentials = webosSource(target).config?.webos;
  if (!credentials) throw new Error("LG webOS requires paired credentials");
  return validateWebOSCredentials(credentials);
}

function getCapabilities(target: InventoryTarget): ReadonlyMap<OperationKind, OperationCapability> {
  const credentials = webosSource(target).config?.webos;
  if (credentials?.clientKey) {
    return new Map(
      [...capabilities].map(([kind, capability]) => [
        kind,
        {
          ...capability,
          reason: "Paired client key configured; live connectivity was not checked",
        },
      ]),
    );
  }
  return new Map(
    [...capabilities].map(([kind, capability]) => [
      kind,
      {
        ...capability,
        readiness: "misconfigured" as const,
        reason: "LG webOS requires a paired client key",
      },
    ]),
  );
}

export function createWebosRegistration(): DriverRegistration {
  return {
    driverId: "lg-ssap",
    platform: "webos",
    createDriver: (target) =>
      createLgWebosDriver({ ip: target.ip, credentials: webosCredentials(target) }),
    getCapabilities,
    lockResourceId: (target) => `device:${target.id}`,
  };
}
