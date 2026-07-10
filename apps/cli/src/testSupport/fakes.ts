import type { DeviceInventory, DeviceSession, OperationRecord } from "@couch/device";

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

export function output() {
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
