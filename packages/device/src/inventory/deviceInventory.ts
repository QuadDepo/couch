import { createDiagnosticEvent, emitDiagnostic } from "../diagnostics/events";
import { deviceLockResourceId } from "../drivers/lockResourceId";
import { createDriverRegistry } from "../drivers/registry";
import type { DeviceDriver, DriverRegistration } from "../drivers/types";
import { createDeviceLock, DEFAULT_DEVICE_LOCK_DIRECTORY } from "../locks/deviceLock";
import { evaluateRequirement } from "../operations/requirements";
import type { OperationCapability, OperationKind } from "../operations/types";
import { createDeviceSession } from "../sessions/deviceSession";
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

function requireRegistration(
  registry: NonNullable<DeviceInventoryOptions["registry"]>,
  target: InventoryTarget,
): DriverRegistration {
  const registration = registry.getRegistration(describeDevice(target));
  if (!registration) {
    throw new DeviceInventoryError(
      "DRIVER_NOT_FOUND",
      `No operation driver is available for ${target.platform} (device ${target.id})`,
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
    const block = evaluateRequirement(capability, kind, allowExperimental);
    if (!block) continue;

    if (block.reason === "experimental") {
      throw new DeviceInventoryError(
        "EXPERIMENTAL_OPERATION",
        `${kind} requires explicit target approval for ${target.id}`,
        "unsupported",
      );
    }

    if (block.reason === "missing") {
      throw new DeviceInventoryError(
        "UNSUPPORTED_OPERATION",
        `${kind} is not offered by any driver for ${target.id}`,
        "unsupported",
      );
    }

    if (block.reason === "not-ready") {
      throw new DeviceInventoryError(
        "UNSUPPORTED_OPERATION",
        `${kind} is not ready for ${target.id} (readiness: ${block.readiness})`,
        "unsupported",
      );
    }

    const detail = capability?.reason ? `: ${capability.reason}` : "";
    throw new DeviceInventoryError(
      "UNSUPPORTED_OPERATION",
      `${kind} is unsupported for ${target.id}${detail}`,
      "unsupported",
    );
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
    if (!target) throw new DeviceInventoryError("DEVICE_NOT_FOUND", `Device ${id} was not found`);
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
      return awaitWithAbort(
        Promise.resolve(registration.getCapabilities(target, { signal: query.signal })),
        query.signal,
      );
    },

    async openSession(id, openOptions) {
      const target = await findTarget(id, openOptions.signal);
      const registration = requireRegistration(registry, target);
      throwIfAborted(openOptions.signal);
      const capabilities = await awaitWithAbort(
        Promise.resolve(registration.getCapabilities(target, { signal: openOptions.signal })),
        openOptions.signal,
      );
      const allowExperimental = openOptions.allowExperimental ?? [];
      checkRequirements(capabilities, target, openOptions.require, allowExperimental);
      throwIfAborted(openOptions.signal);
      const lockHandle = await lock.acquire(deviceLockResourceId(target), {
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
            "DRIVER_NOT_READY",
            `Driver ${registration.driverId} is not ready`,
          );
        }
        await emitDiagnostic(
          options.diagnosticSink,
          createDiagnosticEvent("info", "Device opened", { deviceId: id }),
        ).catch(() => undefined);
        return createDeviceSession({
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
