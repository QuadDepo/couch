import { createDiagnosticEvent, type DiagnosticSink, emitDiagnostic } from "../diagnostics/events";
import { jsonSafeRecord } from "../diagnostics/redact";
import type { DriverReceipt } from "../drivers/types";
import { DeviceInventoryError } from "../inventory/types";
import type {
  DeviceOperation,
  DriverId,
  OperationError,
  OperationRecord,
} from "../operations/types";

function operationInput(operation: DeviceOperation): Record<string, unknown> {
  const { kind: _kind, ...input } = operation;
  return jsonSafeRecord(input);
}

function cancelledError(reason?: unknown): OperationError {
  return {
    code: "cancelled",
    category: "cancelled",
    message: reason instanceof Error ? reason.message : "Operation cancelled",
    retryable: false,
  };
}

function operationError(error: unknown): OperationError {
  if (error instanceof DeviceInventoryError) {
    return { code: error.code, category: error.category, message: error.message, retryable: false };
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return cancelledError(error);
  }
  return {
    code: "driver-failed",
    category: "infrastructure",
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}

interface RecordFields {
  ordinal: number;
  operation: DeviceOperation;
  adapterId: DriverId;
  startedAt: string;
  completedAt: string;
  receipt?: DriverReceipt;
  error?: unknown;
  cancelled?: unknown;
  timeoutMs?: number;
}

export function createOperationRecord(fields: RecordFields): OperationRecord {
  const { receipt } = fields;
  const timedOut = fields.timeoutMs !== undefined;
  const cancelled = fields.cancelled !== undefined;
  return {
    id: crypto.randomUUID(),
    ordinal: fields.ordinal,
    kind: fields.operation.kind,
    adapterId: fields.adapterId,
    status: timedOut ? "failed" : cancelled ? "cancelled" : fields.error ? "failed" : "succeeded",
    ...(!timedOut && !cancelled && receipt?.confirmation
      ? { confirmation: receipt.confirmation }
      : {}),
    startedAt: fields.startedAt,
    completedAt: fields.completedAt,
    input: operationInput(fields.operation),
    ...(timedOut
      ? {
          error: {
            code: "operation-timeout",
            category: "infrastructure" as const,
            message: `Operation timed out after ${fields.timeoutMs}ms`,
            retryable: false,
          },
        }
      : cancelled
        ? { error: cancelledError(fields.cancelled) }
        : fields.error
          ? { error: operationError(fields.error) }
          : {}),
    artifacts: [...(receipt?.artifacts ?? [])],
    ...(receipt?.metadata ? { metadata: jsonSafeRecord(receipt.metadata) } : {}),
  };
}

export function createUnsupportedRecord(
  fields: Omit<RecordFields, "startedAt" | "completedAt"> & {
    message: string;
    experimental: boolean;
  },
): OperationRecord {
  const at = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    ordinal: fields.ordinal,
    kind: fields.operation.kind,
    adapterId: fields.adapterId,
    status: "failed",
    startedAt: at,
    completedAt: at,
    input: operationInput(fields.operation),
    error: {
      code: fields.experimental ? "experimental-operation" : "unsupported-operation",
      category: "unsupported",
      message: fields.message,
      retryable: false,
    },
    artifacts: [],
  };
}

export async function emitOperationRecord(
  sink: DiagnosticSink | undefined,
  deviceId: string,
  record: OperationRecord,
): Promise<void> {
  await emitDiagnostic(
    sink,
    createDiagnosticEvent("info", `Operation ${record.status}`, {
      deviceId,
      operationId: record.id,
      metadata: { kind: record.kind },
    }),
  ).catch(() => undefined);
}
