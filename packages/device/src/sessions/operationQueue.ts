import type { DiagnosticSink } from "../diagnostics/events";
import type { DeviceDriver, DriverReceipt } from "../drivers/types";
import { evaluateRequirement } from "../operations/requirements";
import type {
  DeviceOperation,
  OperationCapability,
  OperationKind,
  OperationRecord,
} from "../operations/types";
import type { ExecuteOptions } from "./deviceSession";
import {
  createBlockedRecord,
  createOperationRecord,
  emitOperationRecord,
} from "./operationRecords";
import { awaitTimeout, now, settlesWithin } from "./timing";

interface PendingOperation extends ExecuteOptions {
  operation: DeviceOperation;
  ordinal: number;
  resolve: (record: OperationRecord) => void;
  cancelled: boolean;
  settled: boolean;
  cancelReason?: unknown;
  onAbort?: () => void;
  cancelPromise: Promise<void>;
  cancelResolve: () => void;
}

export interface QueueDependencies {
  driver: DeviceDriver;
  capabilities: ReadonlyMap<OperationKind, OperationCapability>;
  sink?: DiagnosticSink;
  deviceId: string;
  allowExperimental: readonly OperationKind[];
  requestClose: () => void;
}

// Tracks the driver call currently in flight so close/cancellation can wait on it.
interface ActiveExecution {
  task: Promise<void>;
  receipt?: DriverReceipt;
  error?: unknown;
  timedOut: boolean;
}

export class OperationQueue {
  private readonly pending: PendingOperation[] = [];
  private ordinal = 0;
  private draining = false;
  private closing = false;
  private activeController: AbortController | undefined;
  private activeOperation: PendingOperation | undefined;
  private activeTask: Promise<void> | undefined;

  constructor(private readonly dependencies: QueueDependencies) {}

  execute(operation: DeviceOperation, options: ExecuteOptions): Promise<OperationRecord> {
    const ordinal = ++this.ordinal;
    return new Promise((resolve) => {
      let cancelResolve!: () => void;
      const item: PendingOperation = {
        operation,
        ordinal,
        ...options,
        resolve,
        cancelled: false,
        settled: false,
        cancelPromise: new Promise<void>((done) => {
          cancelResolve = done;
        }),
        cancelResolve: () => cancelResolve(),
      };

      if (this.closing || options.signal?.aborted) {
        this.cancel(item, options.signal?.reason ?? "Session is closed");
        return;
      }

      const capability = this.dependencies.capabilities.get(operation.kind);
      const block = evaluateRequirement(
        capability,
        operation.kind,
        this.dependencies.allowExperimental,
      );
      if (block) {
        resolve(
          createBlockedRecord({
            ordinal,
            operation,
            adapterId: this.dependencies.driver.driverId,
            message:
              capability?.reason ??
              `${operation.kind} is not ready for ${this.dependencies.deviceId}`,
            experimental: block.experimentalBlocked,
          }),
        );
        return;
      }

      item.onAbort = () => this.abort(item);
      options.signal?.addEventListener("abort", item.onAbort, { once: true });
      this.pending.push(item);
      void this.drain();
    });
  }

  close(): void {
    this.closing = true;
    this.cancelQueued("Session is closed");
    this.activeController?.abort(new DOMException("Session is closed", "AbortError"));
    if (this.activeOperation) this.cancel(this.activeOperation, "Session is closed");
  }

  settlesWithin(timeoutMs: number): Promise<boolean> {
    return this.activeTask ? settlesWithin(this.activeTask, timeoutMs) : Promise.resolve(true);
  }

  private abort(item: PendingOperation): void {
    item.cancelled = true;
    item.cancelReason = item.signal?.reason;
    item.cancelResolve();

    if (this.activeOperation === item) {
      this.activeController?.abort(item.cancelReason);
      this.cancelQueued("Session is closed");
      this.cancel(item, item.cancelReason);
      this.dependencies.requestClose();
      return;
    }

    const index = this.pending.indexOf(item);
    if (index >= 0) {
      this.pending.splice(index, 1);
      this.cancel(item, item.cancelReason);
    }
  }

  private cancelQueued(reason: unknown): void {
    for (const item of this.pending.splice(0)) this.cancel(item, reason);
  }

  private cancel(item: PendingOperation, reason: unknown): void {
    item.cancelled = true;
    item.cancelReason = reason;
    item.cancelResolve();
    if (item.onAbort) item.signal?.removeEventListener("abort", item.onAbort);

    if (item.settled) return;
    item.settled = true;

    const at = now();
    item.resolve(
      createOperationRecord({
        ordinal: item.ordinal,
        operation: item.operation,
        adapterId: this.dependencies.driver.driverId,
        startedAt: at,
        completedAt: at,
        cancelled: reason,
      }),
    );
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.length > 0) {
        const item = this.pending.shift();
        if (!item) break;
        if (item.cancelled || this.closing) {
          this.cancel(item, item.cancelReason ?? "Session is closed");
          continue;
        }
        const shouldContinue = await this.run(item);
        if (!shouldContinue) break;
      }
    } finally {
      this.draining = false;
    }
  }

  private async run(item: PendingOperation): Promise<boolean> {
    const startedAt = now();
    const controller = new AbortController();
    this.activeOperation = item;
    this.activeController = controller;

    const execution = this.beginExecution(item, controller);
    await this.waitForExecution(item, controller, execution);

    if (item.onAbort) item.signal?.removeEventListener("abort", item.onAbort);

    const driverSettled = this.activeTask === undefined;
    const cancelled =
      !execution.timedOut && (controller.signal.aborted || item.cancelled || this.closing);

    const record = createOperationRecord({
      ordinal: item.ordinal,
      operation: item.operation,
      adapterId: this.dependencies.driver.driverId,
      startedAt,
      completedAt: now(),
      receipt: execution.receipt,
      error: execution.error,
      ...(execution.timedOut ? { timeoutMs: item.timeoutMs } : {}),
      ...(cancelled ? { cancelled: controller.signal.reason ?? item.cancelReason ?? true } : {}),
    });
    await emitOperationRecord(this.dependencies.sink, this.dependencies.deviceId, record);

    if (!item.settled) {
      item.settled = true;
      item.resolve(record);
    }

    // A timeout, cancellation, or a driver still running after we stopped waiting all
    // leave the device in an unknown state, so tear the session down.
    if (execution.timedOut || cancelled || !driverSettled) {
      this.dependencies.requestClose();
      return false;
    }
    return true;
  }

  private beginExecution(item: PendingOperation, controller: AbortController): ActiveExecution {
    const execution: ActiveExecution = { task: Promise.resolve(), timedOut: false };
    execution.task = (async () => {
      try {
        execution.receipt = await this.dependencies.driver.execute(item.operation, {
          signal: controller.signal,
          ...(item.timeoutMs !== undefined ? { timeoutMs: item.timeoutMs } : {}),
        });
      } catch (caught) {
        execution.error = caught;
      }
    })();

    this.activeTask = execution.task;
    void execution.task.then(() => this.clearActive(execution.task));
    return execution;
  }

  private waitForExecution(
    item: PendingOperation,
    controller: AbortController,
    execution: ActiveExecution,
  ): Promise<void> {
    if (item.timeoutMs !== undefined) {
      return awaitTimeout(execution.task, item.timeoutMs, () => {
        execution.timedOut = true;
        controller.abort(new DOMException("Operation timed out", "AbortError"));
      });
    }
    return Promise.race([execution.task, item.cancelPromise]);
  }

  private clearActive(task: Promise<void>): void {
    if (this.activeTask !== task) return;
    this.activeTask = undefined;
    this.activeController = undefined;
    this.activeOperation = undefined;
  }
}
