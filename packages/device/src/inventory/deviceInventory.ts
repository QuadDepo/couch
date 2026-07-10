import { createDiagnosticEvent, emitDiagnostic } from "../diagnostics/events";
import { createDriverRegistry, getLockResourceId } from "../drivers/registry";
import type { DeviceDriver, DriverRegistration } from "../drivers/types";
import { createDeviceLock, DEFAULT_DEVICE_LOCK_DIRECTORY } from "../locks/deviceLock";
import type { OperationCapability, OperationKind } from "../operations/types";
import { isOperationKind } from "../operations/types";
import { DeviceSessionImpl } from "../sessions/deviceSession";
import { awaitWithAbort, throwIfAborted } from "../sessions/timing";
import { loadDevices } from "./loadInventory";
import { describeDevice, normalizeDevice } from "./normalizeDevice";
import {
  type DeviceInventory,
  DeviceInventoryError,
  type DeviceInventoryOptions,
  type InventoryLoader,
  type InventoryTarget,
} from "./types";

async function capabilitiesFor(
  registration: DriverRegistration,
  target: InventoryTarget,
  signal?: AbortSignal,
): Promise<ReadonlyMap<OperationKind, OperationCapability>> {
  const capabilities = await registration.getCapabilities(target, { signal });
  if (capabilities instanceof Map) return capabilities;
  const result = new Map<OperationKind, OperationCapability>();
  for (const [kind, capability] of Object.entries(capabilities)) {
    if (isOperationKind(kind)) result.set(kind, capability);
  }
  return result;
}

function requireRegistration(
  registry: NonNullable<DeviceInventoryOptions["registry"]>,
  target: InventoryTarget,
): DriverRegistration {
  const registration = registry.getRegistration(describeDevice(target));
  if (!registration) {
    throw new DeviceInventoryError(
      "driver-not-found",
      `No driver is registered for ${target.platform}`,
    );
  }
  return registration;
}

function checkRequirements(
  capabilities: ReadonlyMap<OperationKind, OperationCapability>,
  target: InventoryTarget,
  require: readonly OperationKind[],
  allowExperimental: readonly OperationKind[],
): void {
  for (const kind of require) {
    const capability = capabilities.get(kind);
    if (capability?.readiness !== "ready" || capability.support === "unsupported") {
      throw new DeviceInventoryError(
        "unsupported-operation",
        `${kind} is not ready for ${target.id}`,
        "unsupported",
      );
    }
    if (capability.support === "experimental" && !allowExperimental.includes(kind)) {
      throw new DeviceInventoryError(
        "experimental-operation",
        `${kind} requires explicit target approval`,
        "unsupported",
      );
    }
  }
}

export function createDeviceInventory(options: DeviceInventoryOptions = {}): DeviceInventory {
  const loader: InventoryLoader = options.inventoryLoader ?? loadDevices;
  const registry = options.registry ?? createDriverRegistry();
  const lock = createDeviceLock(
    options.lockDirectory ?? process.env.COUCH_DEVICE_LOCK_DIR ?? DEFAULT_DEVICE_LOCK_DIRECTORY,
  );
  const runId = options.runId ?? crypto.randomUUID();
  const closeTimeoutMs = options.closeTimeoutMs ?? 5_000;
  let inventoryPromise: Promise<readonly InventoryTarget[]> | undefined;

  function inventory(): Promise<readonly InventoryTarget[]> {
    inventoryPromise ??= Promise.resolve(loader()).then((items) =>
      (items ?? []).map(normalizeDevice),
    );
    return inventoryPromise;
  }

  async function findTarget(id: string, signal?: AbortSignal): Promise<InventoryTarget> {
    throwIfAborted(signal);
    const target = (await awaitWithAbort(inventory(), signal)).find((item) => item.id === id);
    if (!target) throw new DeviceInventoryError("device-not-found", `Device ${id} was not found`);
    return target;
  }

  return {
    async listDevices(query = {}) {
      throwIfAborted(query.signal);
      return (await awaitWithAbort(inventory(), query.signal)).map(describeDevice);
    },

    async getDevice(id, query = {}) {
      return describeDevice(await findTarget(id, query.signal));
    },

    async getCapabilities(id, query = {}) {
      const target = await findTarget(id, query.signal);
      const registration = requireRegistration(registry, target);
      throwIfAborted(query.signal);
      return awaitWithAbort(capabilitiesFor(registration, target, query.signal), query.signal);
    },

    async openSession(id, openOptions) {
      const target = await findTarget(id, openOptions.signal);
      const registration = requireRegistration(registry, target);
      throwIfAborted(openOptions.signal);
      const capabilities = await awaitWithAbort(
        capabilitiesFor(registration, target, openOptions.signal),
        openOptions.signal,
      );
      const allowExperimental = openOptions.allowExperimental ?? [];
      checkRequirements(capabilities, target, openOptions.require, allowExperimental);
      throwIfAborted(openOptions.signal);
      const lockHandle = await lock.acquire(getLockResourceId(target, registration), {
        runId,
        signal: openOptions.signal,
      });
      let driver: DeviceDriver | undefined;
      try {
        driver = registration.createDriver(target);
        throwIfAborted(openOptions.signal);
        await driver.open({ signal: openOptions.signal });
        throwIfAborted(openOptions.signal);
        if (!(await driver.isReady())) {
          throw new DeviceInventoryError(
            "driver-not-ready",
            `Driver ${registration.driverId} is not ready`,
          );
        }
        await emitDiagnostic(
          options.diagnosticSink,
          createDiagnosticEvent("info", "Device opened", { deviceId: id }),
        ).catch(() => undefined);
        return new DeviceSessionImpl({
          driver,
          lock: lockHandle,
          capabilities,
          sink: options.diagnosticSink,
          deviceId: id,
          closeTimeoutMs,
          allowExperimental,
        });
      } catch (error) {
        await Promise.resolve(driver?.close()).catch(() => undefined);
        await lockHandle.release();
        throw error;
      }
    },
  };
}
