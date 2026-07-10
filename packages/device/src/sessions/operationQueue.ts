import type { DriverReceipt } from "../drivers/types";
import type { DeviceOperation, OperationRecord } from "../operations/types";
import type { ExecuteOptions } from "./deviceSession";
import type { PendingOperation, QueueDependencies } from "./operationQueueTypes";
import {
  createOperationRecord,
  createUnsupportedRecord,
  emitOperationRecord,
} from "./operationRecords";
import { awaitTimeout, now, settlesWithin } from "./timing";

export class OperationQueue {
  private readonly pending: PendingOperation[] = [];
  private ordinal = 0;
  private draining = false;
  private closing = false;
  private activeController: AbortController | undefined;
  private activeOperation: PendingOperation | undefined;
  private activeDone: Promise<void> | undefined;

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
      const unsupported = capability?.readiness !== "ready" || capability.support === "unsupported";
      const experimental =
        capability?.support === "experimental" &&
        !this.dependencies.allowExperimental.includes(operation.kind);
      if (unsupported || experimental) {
        resolve(
          createUnsupportedRecord({
            ordinal,
            operation,
            adapterId: this.dependencies.driver.adapterId,
            message:
              capability?.reason ??
              `${operation.kind} is not ready for ${this.dependencies.deviceId}`,
            experimental,
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
    return this.activeDone ? settlesWithin(this.activeDone, timeoutMs) : Promise.resolve(true);
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
        adapterId: this.dependencies.driver.adapterId,
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
    let timedOut = false;
    let receipt: DriverReceipt | undefined;
    let error: unknown;
    const activeDone = (async () => {
      try {
        receipt = await this.dependencies.driver.execute(item.operation, {
          signal: controller.signal,
          ...(item.timeoutMs !== undefined ? { timeoutMs: item.timeoutMs } : {}),
        });
      } catch (caught) {
        error = caught;
      }
    })();
    this.activeDone = activeDone;
    void activeDone.then(() => this.clearActive(activeDone));
    if (item.timeoutMs !== undefined) {
      await awaitTimeout(activeDone, item.timeoutMs, () => {
        timedOut = true;
        controller.abort(new DOMException("Operation timed out", "AbortError"));
      });
    } else await Promise.race([activeDone, item.cancelPromise]);
    if (item.onAbort) item.signal?.removeEventListener("abort", item.onAbort);
    const activeSettled = this.activeDone === undefined;
    const cancelled = !timedOut && (controller.signal.aborted || item.cancelled || this.closing);
    const record = createOperationRecord({
      ordinal: item.ordinal,
      operation: item.operation,
      adapterId: this.dependencies.driver.adapterId,
      startedAt,
      completedAt: now(),
      receipt,
      error,
      ...(timedOut ? { timeoutMs: item.timeoutMs } : {}),
      ...(cancelled ? { cancelled: controller.signal.reason ?? item.cancelReason ?? true } : {}),
    });
    await emitOperationRecord(this.dependencies.sink, this.dependencies.deviceId, record);
    if (!item.settled) {
      item.settled = true;
      item.resolve(record);
    }
    if (timedOut || cancelled || !activeSettled) {
      this.dependencies.requestClose();
      return false;
    }
    return true;
  }

  private clearActive(task: Promise<void>): void {
    if (this.activeDone !== task) return;
    this.activeDone = undefined;
    this.activeController = undefined;
    this.activeOperation = undefined;
  }
}
