import { loadDevices } from "../utils/storage";
import {
  createDeviceLock,
  DEFAULT_DEVICE_LOCK_DIRECTORY,
  type DeviceLockHandle,
} from "./deviceLock";
import { createDiagnosticEvent, emitDiagnostic, jsonSafe } from "./diagnostics";
import { createTargetRegistry, getLockResourceId } from "./targetRegistry";
import type {
  DeviceDescriptor,
  DeviceDriver,
  DeviceHarness,
  DeviceOperation,
  DeviceRuntime,
  DeviceRuntimeOptions,
  DiagnosticSink,
  DriverReceipt,
  DriverRegistration,
  InventoryLoader,
  OperationCapability,
  OperationError,
  OperationKind,
  OperationRecord,
  RuntimeTarget,
  TargetRegistry,
} from "./types";

class RuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly category: OperationError["category"] = "infrastructure",
  ) {
    super(message);
    this.name = "RuntimeError";
  }
}

function publicDescriptor(device: RuntimeTarget): DeviceDescriptor {
  return {
    id: device.id,
    name: device.name,
    platform: device.platform,
    ip: device.ip,
    ...(device.mac ? { mac: device.mac } : {}),
    ...(device.driverId ? { driverId: device.driverId } : {}),
  };
}

function normalizeInventoryItem(item: DeviceDescriptor | RuntimeTarget["source"]): RuntimeTarget {
  const raw = item as unknown as Record<string, unknown>;
  const source =
    "config" in raw ||
    item.platform === "lg-webos" ||
    item.platform === "samsung-tizen" ||
    item.platform === "philips-tv"
      ? (item as RuntimeTarget["source"])
      : ({
          id: item.id,
          name: item.name,
          platform: item.platform as RuntimeTarget["source"]["platform"],
          ip: item.ip,
        } as RuntimeTarget["source"]);
  const legacy = (() => {
    switch (item.platform) {
      case "android-tv":
        return { platform: "android-tv", driverId: "adb" } as const;
      case "android-tv-remote":
        return { platform: "android-tv", driverId: "android-remote" } as const;
      case "lg-webos":
        return { platform: "webos", driverId: "lg-ssap" } as const;
      case "philips-tv":
        return { platform: "philips-tv", driverId: "philips-jointspace" } as const;
      case "samsung-tizen":
        return { platform: "tizen", driverId: "samsung-remote" } as const;
      default:
        return { platform: item.platform, driverId: undefined } as const;
    }
  })();
  return {
    id: item.id,
    name: item.name,
    platform: legacy.platform as RuntimeTarget["platform"],
    ip: item.ip,
    ...(item.mac ? { mac: item.mac } : {}),
    driverId: "driverId" in item && item.driverId ? item.driverId : legacy.driverId,
    ...("metadata" in item && item.metadata && typeof item.metadata === "object"
      ? { metadata: item.metadata as Record<string, unknown> }
      : {}),
    source,
  };
}

function asCapabilities(
  registration: DriverRegistration,
  target: RuntimeTarget,
  options: { signal?: AbortSignal } = {},
): Promise<ReadonlyMap<OperationKind, OperationCapability>> {
  return Promise.resolve(registration.getCapabilities(target, options)).then((value) =>
    value instanceof Map
      ? value
      : new Map(Object.entries(value) as [OperationKind, OperationCapability][]),
  );
}

function operationError(error: unknown): OperationError {
  if (error instanceof RuntimeError) {
    return {
      code: error.code,
      category: error.category,
      message: error.message,
      retryable: false,
    };
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return { code: "cancelled", category: "cancelled", message: error.message, retryable: false };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: "driver-failed", category: "infrastructure", message, retryable: false };
}

function cancelledError(reason?: unknown): OperationError {
  return {
    code: "cancelled",
    category: "cancelled",
    message: reason instanceof Error ? reason.message : "Operation cancelled",
    retryable: false,
  };
}

function timeoutError(timeoutMs: number): OperationError {
  return {
    code: "operation-timeout",
    category: "infrastructure",
    message: `Operation timed out after ${timeoutMs}ms`,
    retryable: false,
  };
}

function operationInput(operation: DeviceOperation): Record<string, unknown> {
  const { kind: _kind, ...input } = operation;
  return jsonSafe(input) as Record<string, unknown>;
}

async function settlesWithin(task: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task.then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function succeedsWithin(task: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task.then(
        () => true,
        () => false,
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function now(): string {
  return new Date().toISOString();
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError(signal);
}

async function awaitWithAbort<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return task;

  let onAbort!: () => void;
  const aborted = new Promise<T>((_, reject) => {
    onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([task, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

interface PendingOperation {
  operation: DeviceOperation;
  ordinal: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  resolve: (record: OperationRecord) => void;
  cancelled: boolean;
  settled: boolean;
  cancelReason?: unknown;
  onAbort?: () => void;
  cancelPromise: Promise<void>;
  cancelResolve: () => void;
}

class DeviceHarnessImpl implements DeviceHarness {
  readonly capabilities: ReadonlyMap<OperationKind, OperationCapability>;
  private readonly queue: PendingOperation[] = [];
  private ordinal = 0;
  private draining = false;
  private closing = false;
  private activeController: AbortController | undefined;
  private activeOperation: PendingOperation | undefined;
  private activeDone: Promise<void> | undefined;
  private closePromise: Promise<void> | undefined;
  private driverCloseDone: Promise<void> | undefined;

  constructor(
    private readonly driver: DeviceDriver,
    private readonly lock: DeviceLockHandle,
    private readonly adapterId: DriverRegistration["driverId"],
    capabilities: ReadonlyMap<OperationKind, OperationCapability>,
    private readonly sink: DiagnosticSink | undefined,
    private readonly deviceId: string,
    private readonly closeTimeoutMs: number,
    private readonly allowExperimental: readonly OperationKind[],
  ) {
    this.capabilities = capabilities;
  }

  execute(
    operation: DeviceOperation,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<OperationRecord> {
    const ordinal = ++this.ordinal;
    return new Promise((resolve) => {
      let cancelResolve!: () => void;
      const pending: PendingOperation = {
        operation,
        ordinal,
        ...options,
        resolve,
        cancelled: false,
        settled: false,
        cancelPromise: new Promise<void>((resolveCancel) => {
          cancelResolve = resolveCancel;
        }),
        cancelResolve: () => cancelResolve(),
      };
      if (this.closing || options.signal?.aborted) {
        pending.cancelled = true;
        pending.cancelReason = options.signal?.reason ?? "Harness is closed";
        resolve(this.makeCancelledRecord(pending, now()));
        return;
      }
      const capability = this.capabilities.get(operation.kind);
      const unsupported = capability?.readiness !== "ready" || capability.support === "unsupported";
      const experimentalNotAllowed =
        capability?.support === "experimental" && !this.allowExperimental.includes(operation.kind);
      if (unsupported || experimentalNotAllowed) {
        resolve({
          id: crypto.randomUUID(),
          ordinal,
          kind: operation.kind,
          adapterId: this.adapterId,
          status: "failed",
          startedAt: now(),
          completedAt: now(),
          input: operationInput(operation),
          error: {
            code: experimentalNotAllowed ? "experimental-operation" : "unsupported-operation",
            category: "unsupported",
            message: capability?.reason ?? `${operation.kind} is not ready for ${this.deviceId}`,
            retryable: false,
          },
          artifacts: [],
        });
        return;
      }
      const onAbort = () => {
        pending.cancelled = true;
        pending.cancelReason = options.signal?.reason;
        pending.cancelResolve();
        if (this.activeOperation === pending) {
          this.activeController?.abort(options.signal?.reason);
          this.cancelQueued();
          if (!pending.settled) {
            pending.settled = true;
            pending.resolve(this.makeCancelledRecord(pending, now()));
          }
          void this.close().catch(() => undefined);
          return;
        }
        const index = this.queue.indexOf(pending);
        if (index >= 0) {
          this.queue.splice(index, 1);
          options.signal?.removeEventListener("abort", onAbort);
          pending.settled = true;
          resolve(this.makeCancelledRecord(pending, now()));
        }
      };
      pending.onAbort = onAbort;
      options.signal?.addEventListener("abort", onAbort, { once: true });
      this.queue.push(pending);
      void this.drain();
    });
  }

  private cancelQueued(): void {
    for (const pending of this.queue.splice(0)) {
      pending.cancelled = true;
      pending.cancelReason = "Harness is closed";
      pending.cancelResolve();
      if (pending.onAbort) pending.signal?.removeEventListener("abort", pending.onAbort);
      if (!pending.settled) {
        pending.settled = true;
        pending.resolve(this.makeCancelledRecord(pending, now()));
      }
    }
  }

  private makeCancelledRecord(pending: PendingOperation, at: string): OperationRecord {
    return {
      id: crypto.randomUUID(),
      ordinal: pending.ordinal,
      kind: pending.operation.kind,
      adapterId: this.adapterId,
      status: "cancelled",
      startedAt: at,
      completedAt: at,
      input: operationInput(pending.operation),
      error: cancelledError(pending.cancelReason),
      artifacts: [],
    };
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const pending = this.queue.shift() as PendingOperation;
        if (pending.cancelled || this.closing) {
          if (pending.onAbort) pending.signal?.removeEventListener("abort", pending.onAbort);
          if (!pending.settled) {
            pending.settled = true;
            pending.resolve(this.makeCancelledRecord(pending, now()));
          }
          continue;
        }
        const startedAt = now();
        const controller = new AbortController();
        this.activeOperation = pending;
        this.activeController = controller;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let timedOut = false;
        const abort = (reason?: unknown) => controller.abort(reason);
        if (pending.timeoutMs !== undefined) {
          timeout = setTimeout(() => {
            timedOut = true;
            abort(new DOMException("Operation timed out", "AbortError"));
          }, pending.timeoutMs);
        }
        let receipt: DriverReceipt | undefined;
        let error: unknown;
        this.activeDone = (async () => {
          try {
            receipt = await this.driver.execute(pending.operation, {
              signal: controller.signal,
              ...(pending.timeoutMs !== undefined ? { timeoutMs: pending.timeoutMs } : {}),
            });
          } catch (caught) {
            error = caught;
          }
        })();
        const activeDone = this.activeDone;
        activeDone.then(() => {
          if (this.activeDone === activeDone) {
            this.activeDone = undefined;
            this.activeController = undefined;
            this.activeOperation = undefined;
          }
        });
        if (pending.timeoutMs !== undefined) {
          const settled = await settlesWithin(activeDone, pending.timeoutMs);
          if (!settled && !timedOut) pending.cancelled = true;
        } else {
          await Promise.race([activeDone, pending.cancelPromise]);
          if (this.activeDone === activeDone) await settlesWithin(activeDone, this.closeTimeoutMs);
        }
        if (timeout) clearTimeout(timeout);
        if (pending.onAbort) pending.signal?.removeEventListener("abort", pending.onAbort);
        const activeSettled = this.activeDone === undefined;
        const completedAt = now();
        const cancelled =
          !timedOut && (controller.signal.aborted || pending.cancelled || this.closing);
        const record: OperationRecord = {
          id: crypto.randomUUID(),
          ordinal: pending.ordinal,
          kind: pending.operation.kind,
          adapterId: this.adapterId,
          status: timedOut ? "failed" : cancelled ? "cancelled" : error ? "failed" : "succeeded",
          ...(!timedOut && !cancelled && receipt?.confirmation
            ? { confirmation: receipt.confirmation }
            : {}),
          startedAt,
          completedAt,
          input: operationInput(pending.operation),
          ...(timedOut
            ? { error: timeoutError(pending.timeoutMs ?? 0) }
            : cancelled
              ? { error: cancelledError(controller.signal.reason ?? pending.cancelReason) }
              : error
                ? { error: operationError(error) }
                : {}),
          artifacts: [...(receipt?.artifacts ?? [])],
          ...(receipt?.metadata ? { metadata: jsonSafe(receipt.metadata) } : {}),
        };
        await emitDiagnostic(
          this.sink,
          createDiagnosticEvent("info", `Operation ${record.status}`, {
            deviceId: this.deviceId,
            operationId: record.id,
            metadata: { kind: record.kind },
          }),
        ).catch(() => undefined);
        if (timedOut || cancelled || !activeSettled) {
          if (timedOut && !pending.settled) {
            pending.settled = true;
            pending.resolve(record);
          }
          if (timedOut) void this.close().catch(() => undefined);
          break;
        }
        if (!pending.settled) {
          pending.settled = true;
          pending.resolve(record);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.cancelQueued();
    this.activeController?.abort(new DOMException("Harness is closed", "AbortError"));
    if (this.activeOperation) {
      this.activeOperation.cancelled = true;
      this.activeOperation.cancelReason = "Harness is closed";
      if (this.activeOperation.onAbort) {
        this.activeOperation.signal?.removeEventListener("abort", this.activeOperation.onAbort);
      }
      if (!this.activeOperation.settled) {
        this.activeOperation.settled = true;
        this.activeOperation.resolve(this.makeCancelledRecord(this.activeOperation, now()));
      }
    }
    const attempt = (async () => {
      const active = this.activeDone;
      if (!this.driverCloseDone) {
        const closeTask = Promise.resolve()
          .then(() => this.driver.close())
          .then(() => undefined);
        this.driverCloseDone = closeTask;
        void closeTask.catch(() => {
          if (this.driverCloseDone === closeTask) this.driverCloseDone = undefined;
        });
      }
      const [activeSettled, driverClosed] = await Promise.all([
        active ? settlesWithin(active, this.closeTimeoutMs) : Promise.resolve(true),
        succeedsWithin(this.driverCloseDone, this.closeTimeoutMs),
      ]);
      if (!activeSettled || !driverClosed) {
        throw new RuntimeError(
          "close-timeout",
          `Device ${this.deviceId} did not quiesce within ${this.closeTimeoutMs}ms`,
        );
      }
      await this.lock.release();
    })();
    this.closePromise = attempt.catch((error) => {
      this.closePromise = undefined;
      throw error;
    });
    return this.closePromise;
  }
}

function createLoader(loader?: InventoryLoader): InventoryLoader {
  return loader ?? loadDevices;
}

export function createDeviceRuntime(options: DeviceRuntimeOptions = {}): DeviceRuntime {
  const loader = createLoader(options.inventoryLoader);
  const registry: TargetRegistry = options.registry ?? createTargetRegistry();
  const lock = createDeviceLock(
    options.lockDirectory ?? process.env.COUCH_DEVICE_LOCK_DIR ?? DEFAULT_DEVICE_LOCK_DIRECTORY,
  );
  const sink = options.diagnosticSink;
  const runId = options.runId ?? crypto.randomUUID();
  const closeTimeoutMs = options.closeTimeoutMs ?? 5_000;
  let inventoryPromise: Promise<readonly RuntimeTarget[]> | undefined;

  async function inventory(): Promise<readonly RuntimeTarget[]> {
    if (!inventoryPromise) {
      inventoryPromise = Promise.resolve(loader()).then((items) =>
        (items ?? []).map(normalizeInventoryItem),
      );
    }
    return inventoryPromise;
  }

  return {
    async listDevices(queryOptions = {}) {
      throwIfAborted(queryOptions.signal);
      return (await awaitWithAbort(inventory(), queryOptions.signal)).map(publicDescriptor);
    },

    async getDevice(id, queryOptions = {}) {
      throwIfAborted(queryOptions.signal);
      const target = (await awaitWithAbort(inventory(), queryOptions.signal)).find(
        (item) => item.id === id,
      );
      if (!target) throw new RuntimeError("device-not-found", `Device ${id} was not found`);
      return publicDescriptor(target);
    },

    async getCapabilities(id, queryOptions = {}) {
      throwIfAborted(queryOptions.signal);
      const target = (await awaitWithAbort(inventory(), queryOptions.signal)).find(
        (item) => item.id === id,
      );
      if (!target) throw new RuntimeError("device-not-found", `Device ${id} was not found`);
      const registration = registry.getRegistration(publicDescriptor(target));
      if (!registration)
        throw new RuntimeError(
          "driver-not-found",
          `No driver is registered for ${target.platform}`,
        );
      throwIfAborted(queryOptions.signal);
      return awaitWithAbort(
        asCapabilities(registration, target, queryOptions),
        queryOptions.signal,
      );
    },

    async openDevice(id, openOptions) {
      throwIfAborted(openOptions.signal);
      const target = (await awaitWithAbort(inventory(), openOptions.signal)).find(
        (item) => item.id === id,
      );
      if (!target) throw new RuntimeError("device-not-found", `Device ${id} was not found`);
      const registration = registry.getRegistration(publicDescriptor(target));
      if (!registration)
        throw new RuntimeError(
          "driver-not-found",
          `No driver is registered for ${target.platform}`,
        );
      throwIfAborted(openOptions.signal);
      const capabilities = await awaitWithAbort(
        asCapabilities(registration, target, { signal: openOptions.signal }),
        openOptions.signal,
      );
      throwIfAborted(openOptions.signal);
      for (const kind of openOptions.require) {
        const capability = capabilities.get(kind);
        if (capability?.readiness !== "ready" || capability.support === "unsupported") {
          throw new RuntimeError(
            "unsupported-operation",
            `${kind} is not ready for ${target.id}`,
            "unsupported",
          );
        }
        if (
          capability.support === "experimental" &&
          !openOptions.allowExperimental?.includes(kind)
        ) {
          throw new RuntimeError(
            "experimental-operation",
            `${kind} requires explicit target approval`,
            "unsupported",
          );
        }
      }
      const resourceId = getLockResourceId(target, registration);
      const lockHandle = await lock.acquire(resourceId, { runId, signal: openOptions.signal });
      let driver: DeviceDriver | undefined;
      try {
        driver = registration.createDriver(target);
        throwIfAborted(openOptions.signal);
        await driver.open({ signal: openOptions.signal });
        throwIfAborted(openOptions.signal);
        if (!(await driver.isReady()))
          throw new RuntimeError(
            "driver-not-ready",
            `Driver ${registration.driverId} is not ready`,
          );
        await emitDiagnostic(
          sink,
          createDiagnosticEvent("info", "Device opened", { deviceId: id }),
        ).catch(() => undefined);
        return new DeviceHarnessImpl(
          driver,
          lockHandle,
          driver.adapterId,
          capabilities,
          sink,
          id,
          closeTimeoutMs,
          openOptions.allowExperimental ?? [],
        );
      } catch (error) {
        await Promise.resolve(driver?.close()).catch(() => undefined);
        await lockHandle.release();
        throw error;
      }
    },
  };
}

export { RuntimeError };
