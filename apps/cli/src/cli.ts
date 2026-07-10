import type {
  DeviceHarness,
  DeviceRuntime,
  DeviceRuntimeOptions,
  OperationRecord,
  RemoteKey,
} from "@couch/device";

const USAGE_EXIT = 64;
const INTERRUPTED_EXIT = 130;
const TERMINATED_EXIT = 143;
const FAILURE_EXIT = 2;

const REMOTE_KEYS = [
  "UP",
  "DOWN",
  "LEFT",
  "RIGHT",
  "OK",
  "BACK",
  "HOME",
  "MENU",
  "EXIT",
  "INFO",
  "POWER",
  "VOLUME_UP",
  "VOLUME_DOWN",
  "MUTE",
  "CHANNEL_UP",
  "CHANNEL_DOWN",
  "INPUT",
  "PLAY",
  "PAUSE",
  "STOP",
  "REWIND",
  "FAST_FORWARD",
] as const satisfies readonly RemoteKey[];

const REMOTE_KEY_SET: ReadonlySet<string> = new Set(REMOTE_KEYS);

const HELP = `Usage: couch remote press <device-id> <KEY> [options]

Send a remote key to an inventory device.

Options:
  --times N  Send the key N times (default: 1)
  --json     Emit one JSON result on stdout
  -h, --help Show this help
`;

interface ParsedPress {
  deviceId: string;
  key: RemoteKey;
  times: number;
  json: boolean;
}

interface CliSignalTarget {
  on(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  removeListener?(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off?(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

interface CliDependencies {
  createRuntime?: (options?: DeviceRuntimeOptions) => DeviceRuntime | Promise<DeviceRuntime>;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  signalTarget?: CliSignalTarget;
}

interface PressResult {
  resultVersion: 1;
  command: "remote.press";
  targetId: string;
  key: RemoteKey;
  requestedTimes: number;
  status: "succeeded" | "failed" | "cancelled";
  exitCode: 0 | 2 | 130 | 143;
  operations: OperationRecord[];
  error?: { code: string; message: string };
  cleanupError?: { code: string; message: string };
}

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

function parseTimes(value: string): number {
  if (!/^\d+$/.test(value)) throw new UsageError("--times expects a positive integer");
  const times = Number(value);
  if (!Number.isSafeInteger(times) || times < 1) {
    throw new UsageError("--times expects a positive integer");
  }
  return times;
}

function parsePress(args: readonly string[]): ParsedPress {
  if (args.length < 4 || args[0] !== "remote" || args[1] !== "press") {
    throw new UsageError("expected: couch remote press <device-id> <KEY>");
  }

  const deviceId = args[2];
  const keyValue = args[3];
  if (!deviceId || !keyValue || deviceId.startsWith("-") || keyValue.startsWith("-")) {
    throw new UsageError("device-id and KEY are required");
  }
  if (!REMOTE_KEY_SET.has(keyValue)) {
    throw new UsageError(`unknown remote key: ${keyValue}`);
  }

  let times = 1;
  let json = false;
  for (let index = 4; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--times") {
      const value = args[++index];
      if (value === undefined) throw new UsageError("--times expects a positive integer");
      times = parseTimes(value);
      continue;
    }
    throw new UsageError(`unknown option: ${argument}`);
  }

  return { deviceId, key: keyValue as RemoteKey, times, json };
}

function removeSignalListener(
  target: CliSignalTarget,
  signal: "SIGINT" | "SIGTERM",
  listener: () => void,
): void {
  if (target.removeListener) {
    target.removeListener(signal, listener);
  } else {
    target.off?.(signal, listener);
  }
}

function errorDetails(error: unknown): { code: string; message: string } {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return { code: (error as { code: string }).code, message: error.message };
  }
  if (error instanceof Error) return { code: "runtime-failed", message: error.message };
  return { code: "runtime-failed", message: String(error) };
}

function resultStatus(records: readonly OperationRecord[]): PressResult["status"] {
  const last = records.at(-1);
  if (!last || last.status === "succeeded") return "succeeded";
  return last.status;
}

function humanResult(result: PressResult): string {
  const operations = result.operations.map((operation) => {
    const confirmation = operation.confirmation ? ` (${operation.confirmation})` : "";
    return `${operation.ordinal}/${result.requestedTimes} ${result.key} ${operation.status}${confirmation}`;
  });
  const summary = `remote.press ${result.targetId}: ${result.status} (${result.operations.length}/${result.requestedTimes})`;
  return `${[...operations, summary].join("\n")}\n`;
}

function writeResult(result: PressResult, json: boolean, stdout: (text: string) => void): void {
  stdout(json ? `${JSON.stringify(result)}\n` : humanResult(result));
}

function writeFailure(
  result: PressResult,
  json: boolean,
  stdout: (text: string) => void,
  stderr: (text: string) => void,
): void {
  writeResult(result, json, stdout);
  if (result.error) stderr(`${result.error.code}: ${result.error.message}\n`);
  if (result.cleanupError) {
    stderr(`${result.cleanupError.code}: ${result.cleanupError.message}\n`);
  }
}

function signalMessage(signal: "SIGINT" | "SIGTERM"): string {
  return signal === "SIGINT" ? "Interrupted" : "Terminated";
}

export async function runCli(
  args: readonly string[],
  dependencies: CliDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = dependencies.stderr ?? ((text: string) => process.stderr.write(text));

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    stdout(HELP);
    return 0;
  }
  if (args[0] === "remote" && args[1] === "press" && args.includes("--help")) {
    stdout(HELP);
    return 0;
  }

  let parsed: ParsedPress;
  try {
    parsed = parsePress(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(`usage: ${message}\n\n${HELP}`);
    return USAGE_EXIT;
  }

  const createRuntime =
    dependencies.createRuntime ??
    (async (options: DeviceRuntimeOptions = {}) => {
      const { createDeviceRuntime } = await import("@couch/device");
      return createDeviceRuntime(options);
    });
  const signalTarget = dependencies.signalTarget ?? process;
  const abortController = new AbortController();
  let signalExit: typeof INTERRUPTED_EXIT | typeof TERMINATED_EXIT | undefined;
  let harness: DeviceHarness | undefined;
  let result: PressResult | undefined;
  let caughtError: { code: string; message: string } | undefined;
  let closeError: { code: string; message: string } | undefined;
  let closePromise: Promise<void> | undefined;

  const closeHarness = (): Promise<void> => {
    if (!harness) return Promise.resolve();
    closePromise ??= Promise.resolve()
      .then(() => harness?.close())
      .then(() => undefined);
    return closePromise;
  };

  const onInterrupt = () => {
    signalExit = INTERRUPTED_EXIT;
    abortController.abort(new DOMException(signalMessage("SIGINT"), "AbortError"));
    void closeHarness().catch(() => undefined);
  };
  const onTerminate = () => {
    signalExit = TERMINATED_EXIT;
    abortController.abort(new DOMException(signalMessage("SIGTERM"), "AbortError"));
    void closeHarness().catch(() => undefined);
  };

  signalTarget.on("SIGINT", onInterrupt);
  signalTarget.on("SIGTERM", onTerminate);
  try {
    try {
      const runtime = await createRuntime({
        diagnosticSink: (event) => {
          stderr(`${event.level}: ${event.message}\n`);
        },
      });
      harness = await runtime.openDevice(parsed.deviceId, {
        require: ["control.press"],
        signal: abortController.signal,
      });
      const operations: OperationRecord[] = [];
      for (let ordinal = 0; ordinal < parsed.times; ordinal += 1) {
        const operation = await harness.execute(
          { kind: "control.press", key: parsed.key },
          { signal: abortController.signal },
        );
        operations.push(operation);
        if (operation.status !== "succeeded") break;
      }
      const status = resultStatus(operations);
      const operationError = operations.at(-1)?.error;
      result = {
        resultVersion: 1,
        command: "remote.press",
        targetId: parsed.deviceId,
        key: parsed.key,
        requestedTimes: parsed.times,
        status,
        exitCode: status === "succeeded" ? 0 : FAILURE_EXIT,
        operations,
        ...(operationError
          ? { error: { code: operationError.code, message: operationError.message } }
          : {}),
      };
    } catch (error) {
      caughtError = errorDetails(error);
    }
  } finally {
    try {
      await closeHarness();
    } catch (error) {
      closeError = errorDetails(error);
    } finally {
      removeSignalListener(signalTarget, "SIGINT", onInterrupt);
      removeSignalListener(signalTarget, "SIGTERM", onTerminate);
    }
  }

  if (signalExit !== undefined) {
    const interrupted: PressResult = {
      resultVersion: 1,
      command: "remote.press",
      targetId: parsed.deviceId,
      key: parsed.key,
      requestedTimes: parsed.times,
      status: "cancelled",
      exitCode: signalExit,
      error: {
        code: "cancelled",
        message: signalMessage(signalExit === INTERRUPTED_EXIT ? "SIGINT" : "SIGTERM"),
      },
      operations: result?.operations ?? [],
      ...(closeError ? { cleanupError: closeError } : {}),
    };
    writeFailure(interrupted, parsed.json, stdout, stderr);
    return signalExit;
  }

  if (caughtError) {
    const failed: PressResult = {
      resultVersion: 1,
      command: "remote.press",
      targetId: parsed.deviceId,
      key: parsed.key,
      requestedTimes: parsed.times,
      status: "failed",
      exitCode: FAILURE_EXIT,
      error: caughtError,
      operations: result?.operations ?? [],
      ...(closeError ? { cleanupError: closeError } : {}),
    };
    writeFailure(failed, parsed.json, stdout, stderr);
    return FAILURE_EXIT;
  }

  if (!result) {
    const failed: PressResult = {
      resultVersion: 1,
      command: "remote.press",
      targetId: parsed.deviceId,
      key: parsed.key,
      requestedTimes: parsed.times,
      status: "failed",
      exitCode: FAILURE_EXIT,
      operations: [],
      error: closeError ?? { code: "runtime-failed", message: "Runtime produced no result" },
    };
    writeFailure(failed, parsed.json, stdout, stderr);
    return FAILURE_EXIT;
  }
  if (closeError) {
    result = {
      ...result,
      status: "failed",
      exitCode: FAILURE_EXIT,
      error: closeError,
    };
  }
  writeResult(result, parsed.json, stdout);
  if (result.status !== "succeeded") {
    if (result.error) stderr(`${result.error.code}: ${result.error.message}\n`);
    return FAILURE_EXIT;
  }
  return 0;
}
