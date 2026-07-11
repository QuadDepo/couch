import { createDiagnosticEvent, type DiagnosticSink, emitDiagnostic } from "../diagnostics/events";
import { jsonSafeRecord } from "../diagnostics/redact";
import type { DriverReceipt } from "../drivers/types";
import { DeviceInventoryError } from "../errors";
import type {
  Confirmation,
  DeviceOperation,
  DriverId,
  OperationError,
  OperationRecord,
  OperationStatus,
} from "../operations/types";

function operationInput(operation: DeviceOperation): Record<string, unknown> {
  const { kind: _kind, ...input } = operation;
  return jsonSafeRecord(input);
}

function cancelledError(reason?: unknown): OperationError {
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "Operation cancelled";
  return { code: "cancelled", category: "cancelled", message, retryable: false };
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

interface OperationOutcome {
  status: OperationStatus;
  error?: OperationError;
  confirmation?: Confirmation;
}

function resolveOutcome(fields: RecordFields): OperationOutcome {
  if (fields.timeoutMs !== undefined) {
    return {
      status: "failed",
      error: {
        code: "operation-timeout",
        category: "infrastructure",
        message: `Operation timed out after ${fields.timeoutMs}ms`,
        retryable: false,
      },
    };
  }

  if (fields.cancelled !== undefined) {
    return { status: "cancelled", error: cancelledError(fields.cancelled) };
  }

  if (fields.error) {
    return { status: "failed", error: operationError(fields.error) };
  }

  const confirmation = fields.receipt?.confirmation;
  return confirmation ? { status: "succeeded", confirmation } : { status: "succeeded" };
}

export function createOperationRecord(fields: RecordFields): OperationRecord {
  const { receipt } = fields;
  const outcome = resolveOutcome(fields);

  return {
    id: crypto.randomUUID(),
    ordinal: fields.ordinal,
    kind: fields.operation.kind,
    adapterId: fields.adapterId,
    status: outcome.status,
    ...(outcome.confirmation ? { confirmation: outcome.confirmation } : {}),
    startedAt: fields.startedAt,
    completedAt: fields.completedAt,
    input: operationInput(fields.operation),
    ...(outcome.error ? { error: outcome.error } : {}),
    artifacts: [...(receipt?.artifacts ?? [])],
    ...(receipt?.metadata ? { metadata: jsonSafeRecord(receipt.metadata) } : {}),
  };
}

// Covers both unsupported operations and experimental ops the session disallows.
export function createBlockedRecord(
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
