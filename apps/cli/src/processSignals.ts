import type { CommandError } from "./errors";
import { errorDetails } from "./errors";

export interface CliSignalTarget {
  on(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  removeListener?(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off?(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

export interface SignalControl {
  readonly signal: AbortSignal;
  readonly exitCode: 130 | 143 | undefined;
  readonly message: string | undefined;
  setCleanup(cleanup: () => Promise<void>): void;
  cleanup(): Promise<CommandError | undefined>;
  dispose(): void;
}

export function installSignalControl(target: CliSignalTarget): SignalControl {
  const controller = new AbortController();
  let exitCode: 130 | 143 | undefined;
  let message: string | undefined;
  let cleanupTask: (() => Promise<void>) | undefined;
  let cleanupPromise: Promise<void> | undefined;

  const cleanup = async (): Promise<CommandError | undefined> => {
    if (!cleanupTask) return undefined;
    cleanupPromise ??= Promise.resolve().then(cleanupTask);
    try {
      await cleanupPromise;
      return undefined;
    } catch (error) {
      return errorDetails(error);
    }
  };
  const cancel = (signal: "SIGINT" | "SIGTERM") => {
    exitCode ??= signal === "SIGINT" ? 130 : 143;
    message ??= signal === "SIGINT" ? "Interrupted" : "Terminated";
    controller.abort(new DOMException(message, "AbortError"));
    void cleanup();
  };
  const onInterrupt = () => cancel("SIGINT");
  const onTerminate = () => cancel("SIGTERM");

  target.on("SIGINT", onInterrupt);
  target.on("SIGTERM", onTerminate);

  return {
    signal: controller.signal,
    get exitCode() {
      return exitCode;
    },
    get message() {
      return message;
    },
    setCleanup(task) {
      cleanupTask = task;
    },
    cleanup,
    dispose() {
      if (target.removeListener) {
        target.removeListener("SIGINT", onInterrupt);
        target.removeListener("SIGTERM", onTerminate);
      } else {
        target.off?.("SIGINT", onInterrupt);
        target.off?.("SIGTERM", onTerminate);
      }
    },
  };
}
