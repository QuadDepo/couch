function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function jsonSafeRecord(value: Record<string, unknown>): Record<string, unknown> {
  try {
    const seen = new WeakSet<object>();
    const serialized: unknown = JSON.parse(
      JSON.stringify(value, (_key, child: unknown) => {
        if (typeof child === "bigint") return `${child}n`;
        if (typeof child === "number" && !Number.isFinite(child)) return String(child);
        if (typeof child === "object" && child !== null) {
          if (seen.has(child)) return "[Circular]";
          seen.add(child);
        }
        return child;
      }),
    );
    if (isRecord(serialized)) return serialized;
    return { value: serialized };
  } catch {
    return { value: String(value) };
  }
}
