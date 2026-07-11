import type { DiagnosticSink } from "../diagnostics/events";
import type { DeviceDriver } from "../drivers/types";
import type { DeviceLockHandle } from "../locks/deviceLock";
import type {
  DeviceOperation,
  OperationCapability,
  OperationKind,
  OperationRecord,
} from "../operations/types";
import { OperationQueue } from "./operationQueue";
import { succeedsWithin } from "./timing";

export interface ExecuteOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface DeviceSession {
  readonly capabilities: ReadonlyMap<OperationKind, OperationCapability>;
  execute(operation: DeviceOperation, options?: ExecuteOptions): Promise<OperationRecord>;
  close(): Promise<void>;
}

class DeviceSessionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DeviceSessionError";
  }
}

interface SessionDependencies {
  driver: DeviceDriver;
  lock: DeviceLockHandle;
  capabilities: ReadonlyMap<OperationKind, OperationCapability>;
  sink?: DiagnosticSink;
  deviceId: string;
  closeTimeoutMs: number;
  allowExperimental: readonly OperationKind[];
}

export function createDeviceSession(dependencies: SessionDependencies): DeviceSession {
  let closePromise: Promise<void> | undefined;
  let driverCloseDone: Promise<void> | undefined;

  const queue = new OperationQueue({
    ...dependencies,
    requestClose: () => void close().catch(() => undefined),
  });

  function close(): Promise<void> {
    if (closePromise) return closePromise;
    queue.close();
    const attempt = (async () => {
      if (!driverCloseDone) {
        const task = Promise.resolve()
          .then(() => dependencies.driver.close())
          .then(() => undefined);
        driverCloseDone = task;
        void task.catch(() => {
          if (driverCloseDone === task) driverCloseDone = undefined;
        });
      }
      // Release the device lock only once both the in-flight operation has settled and the
      // driver has torn down; freeing it early would let another session grab a device the
      // previous driver is still talking to.
      const [activeSettled, driverClosed] = await Promise.all([
        queue.settlesWithin(dependencies.closeTimeoutMs),
        succeedsWithin(driverCloseDone, dependencies.closeTimeoutMs),
      ]);
      if (!activeSettled || !driverClosed) {
        throw new DeviceSessionError(
          "close-timeout",
          `Device ${dependencies.deviceId} did not quiesce within ${dependencies.closeTimeoutMs}ms`,
        );
      }
      await dependencies.lock.release();
    })();
    closePromise = attempt.catch((error) => {
      closePromise = undefined;
      throw error;
    });
    return closePromise;
  }

  return {
    capabilities: dependencies.capabilities,
    execute(operation: DeviceOperation, options: ExecuteOptions = {}): Promise<OperationRecord> {
      return queue.execute(operation, options);
    },
    close,
  };
}
