export interface DiagnosticEvent {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  deviceId?: string;
  operationId?: string;
  metadata?: Record<string, unknown>;
  at: string;
}

export type DiagnosticSink = (event: DiagnosticEvent) => void | Promise<void>;

export function createDiagnosticEvent(
  level: DiagnosticEvent["level"],
  message: string,
  fields: Omit<DiagnosticEvent, "level" | "message" | "at"> = {},
): DiagnosticEvent {
  return { level, message, at: new Date().toISOString(), ...fields };
}

export async function emitDiagnostic(
  sink: DiagnosticSink | undefined,
  event: DiagnosticEvent,
): Promise<void> {
  if (!sink) return;
  await sink(event);
}
