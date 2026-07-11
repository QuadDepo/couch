import type {
  DeviceInventory,
  DeviceOperation,
  DeviceSession,
  OperationRecord,
} from "@couch/device";

export function operationRecord(
  operation: DeviceOperation,
  status: OperationRecord["status"],
  metadata?: Record<string, unknown>,
): OperationRecord {
  return {
    id: crypto.randomUUID(),
    ordinal: 1,
    kind: operation.kind,
    adapterId: "adb",
    status,
    ...(status === "succeeded" ? { confirmation: "process-exit" as const } : {}),
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:00.100Z",
    input: operation,
    artifacts: [],
    ...(metadata ? { metadata } : {}),
    ...(status !== "succeeded"
      ? {
          error: {
            code: status === "cancelled" ? "cancelled" : "adb-failed",
            category: status === "cancelled" ? ("cancelled" as const) : ("infrastructure" as const),
            message: status === "cancelled" ? "cancelled" : "ADB transport failed",
            retryable: false,
          },
        }
      : {}),
  };
}

export function record(
  ordinal: number,
  status: OperationRecord["status"] = "succeeded",
): OperationRecord {
  return {
    id: `operation-${ordinal}`,
    ordinal,
    kind: "control.press",
    adapterId: "fake",
    status,
    ...(status === "succeeded" ? { confirmation: "process-exit" as const } : {}),
    startedAt: `2026-01-01T00:00:0${ordinal}.000Z`,
    completedAt: `2026-01-01T00:00:0${ordinal}.100Z`,
    input: { key: "LEFT" },
    ...(status === "succeeded"
      ? {}
      : {
          error: {
            code: status === "cancelled" ? "cancelled" : "driver-failed",
            category: status === "cancelled" ? ("cancelled" as const) : ("infrastructure" as const),
            message: status === "cancelled" ? "cancelled" : "driver failed",
            retryable: false,
          },
        }),
    artifacts: [],
  };
}

export function inventoryWithSession(session: DeviceSession): DeviceInventory {
  return {
    listDevices: async () => [],
    getDevice: async () => ({
      id: "lab",
      name: "Lab",
      platform: "android-tv",
      ip: "127.0.0.1",
    }),
    getCapabilities: async () => new Map(),
    openSession: async () => session,
  };
}

export function waitForAbort(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    const abort = () => reject(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

export function output(): {
  stdout: string[];
  stderr: string[];
  writeOut: (text: string) => void;
  writeErr: (text: string) => void;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    writeOut: (text: string) => stdout.push(text),
    writeErr: (text: string) => stderr.push(text),
  };
}

export interface FakeSignalTarget {
  handlers: Partial<Record<"SIGINT" | "SIGTERM", () => void>>;
  added: string[];
  removed: string[];
  on(signal: "SIGINT" | "SIGTERM", listener: () => void): void;
  removeListener(signal: "SIGINT" | "SIGTERM", listener: () => void): void;
  emit(signal: "SIGINT" | "SIGTERM"): void;
}

export function signalTarget(): FakeSignalTarget {
  return {
    handlers: {},
    added: [],
    removed: [],
    on(signal, listener) {
      this.handlers[signal] = listener;
      this.added.push(signal);
    },
    removeListener(signal) {
      delete this.handlers[signal];
      this.removed.push(signal);
    },
    emit(signal) {
      this.handlers[signal]?.();
    },
  };
}
