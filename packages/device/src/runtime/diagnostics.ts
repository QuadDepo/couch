import type { DiagnosticEvent, DiagnosticSink } from "./types";

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
  if (typeof sink === "function") {
    await sink(event);
    return;
  }
  await sink.emit(event);
}

export function jsonSafe<T>(value: T): T {
  try {
    const seen = new WeakSet<object>();
    return JSON.parse(
      JSON.stringify(value, (_key, child: unknown) => {
        if (typeof child === "bigint") return `${child}n`;
        if (typeof child === "number" && !Number.isFinite(child)) return String(child);
        if (typeof child === "object" && child !== null) {
          if (seen.has(child)) return "[Circular]";
          seen.add(child);
        }
        return child;
      }),
    ) as T;
  } catch {
    return String(value) as T;
  }
}
