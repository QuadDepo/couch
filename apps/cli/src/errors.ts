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
  if (error instanceof Error) {
    if ("code" in error && typeof error.code === "string") {
      return { code: error.code, message: error.message };
    }
    return { code: "runtime-failed", message: error.message };
  }
  return { code: "runtime-failed", message: String(error) };
}
