export const USAGE_EXIT = 64;
export const FAILURE_EXIT = 2;

export type CommandExitCode = 0 | 1 | 2 | 130 | 143;
export type CommandError = { code: string; message: string };

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export function errorDetails(error: unknown): CommandError {
  if (error instanceof Error && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return { code, message: error.message };
  }
  if (error instanceof Error) return { code: "runtime-failed", message: error.message };
  return { code: "runtime-failed", message: String(error) };
}
