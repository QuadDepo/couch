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

export class DeviceSessionError extends Error {
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

export class DeviceSessionImpl implements DeviceSession {
  readonly capabilities: ReadonlyMap<OperationKind, OperationCapability>;
  private readonly queue: OperationQueue;
  private closePromise: Promise<void> | undefined;
  private driverCloseDone: Promise<void> | undefined;

  constructor(private readonly dependencies: SessionDependencies) {
    this.capabilities = dependencies.capabilities;
    this.queue = new OperationQueue({
      ...dependencies,
      requestClose: () => void this.close().catch(() => undefined),
    });
  }

  execute(operation: DeviceOperation, options: ExecuteOptions = {}): Promise<OperationRecord> {
    return this.queue.execute(operation, options);
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.queue.close();
    const attempt = (async () => {
      if (!this.driverCloseDone) {
        const task = Promise.resolve()
          .then(() => this.dependencies.driver.close())
          .then(() => undefined);
        this.driverCloseDone = task;
        void task.catch(() => {
          if (this.driverCloseDone === task) this.driverCloseDone = undefined;
        });
      }
      const [activeSettled, driverClosed] = await Promise.all([
        this.queue.settlesWithin(this.dependencies.closeTimeoutMs),
        succeedsWithin(this.driverCloseDone, this.dependencies.closeTimeoutMs),
      ]);
      if (!activeSettled || !driverClosed) {
        throw new DeviceSessionError(
          "close-timeout",
          `Device ${this.dependencies.deviceId} did not quiesce within ${this.dependencies.closeTimeoutMs}ms`,
        );
      }
      await this.dependencies.lock.release();
    })();
    this.closePromise = attempt.catch((error) => {
      this.closePromise = undefined;
      throw error;
    });
    return this.closePromise;
  }
}
