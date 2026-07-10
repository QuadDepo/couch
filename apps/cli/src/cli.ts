import type {
  DeviceDescriptor,
  DeviceHarness,
  DeviceRuntime,
  DeviceRuntimeOptions,
  OperationCapability,
  OperationKind,
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

const HELP = `Usage:
  couch device list [--json]
  couch device doctor <target> [--json]
  couch remote press <target> <KEY> [--times N] [--json]

Options:
  --times N  Send the key N times (default: 1)
  --json     Emit one JSON result on stdout
  -h, --help Show this help
`;

interface ParsedList {
  command: "device.list";
  json: boolean;
}

interface ParsedDoctor {
  command: "device.doctor";
  targetId: string;
  json: boolean;
}

interface ParsedPress {
  command: "remote.press";
  targetId: string;
  key: RemoteKey;
  requestedTimes: number;
  json: boolean;
}

type ParsedCommand = ParsedList | ParsedDoctor | ParsedPress;
type CommandExitCode = 0 | 2 | 130 | 143;
type CommandError = { code: string; message: string };

interface ResultBase {
  resultVersion: 1;
  status: string;
  exitCode: CommandExitCode;
  error?: CommandError;
  cleanupError?: CommandError;
}

type PublicDeviceSummary = Pick<
  DeviceDescriptor,
  "id" | "name" | "platform" | "ip" | "mac" | "driverId"
>;

interface DeviceListResult extends ResultBase {
  command: "device.list";
  status: "succeeded" | "failed" | "cancelled";
  devices: readonly PublicDeviceSummary[];
}

interface DoctorCapability extends OperationCapability {
  kind: OperationKind;
  remediation: string;
}

interface DeviceDoctorResult extends ResultBase {
  command: "device.doctor";
  targetId: string;
  status: "ready" | "unverified" | "not-ready" | "failed" | "cancelled";
  readinessScope: "live" | "configuration-only" | "unknown";
  target?: PublicDeviceSummary;
  capabilities: readonly DoctorCapability[];
}

interface PressResult extends ResultBase {
  command: "remote.press";
  targetId: string;
  key: RemoteKey;
  requestedTimes: number;
  status: "succeeded" | "failed" | "cancelled";
  operations: readonly OperationRecord[];
}

type CliResult = DeviceListResult | DeviceDoctorResult | PressResult;

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

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

function parseJsonOption(args: readonly string[]): boolean {
  let json = false;
  for (const argument of args) {
    if (argument === "--json") {
      if (json) throw new UsageError("--json may only be specified once");
      json = true;
      continue;
    }
    throw new UsageError(`unknown option: ${argument}`);
  }
  return json;
}

function parseTimes(value: string): number {
  if (!/^\d+$/.test(value)) throw new UsageError("--times expects a positive integer");
  const times = Number(value);
  if (!Number.isSafeInteger(times) || times < 1) {
    throw new UsageError("--times expects a positive integer");
  }
  return times;
}

function parseCommand(args: readonly string[]): ParsedCommand {
  if (args[0] === "device" && args[1] === "list") {
    return { command: "device.list", json: parseJsonOption(args.slice(2)) };
  }
  if (args[0] === "device" && args[1] === "doctor") {
    const targetId = args[2];
    if (!targetId || targetId.startsWith("-")) {
      throw new UsageError("expected: couch device doctor <target>");
    }
    return {
      command: "device.doctor",
      targetId,
      json: parseJsonOption(args.slice(3)),
    };
  }
  if (args[0] !== "remote" || args[1] !== "press") {
    throw new UsageError("expected device list, device doctor, or remote press");
  }

  const targetId = args[2];
  const keyValue = args[3];
  if (!targetId || !keyValue || targetId.startsWith("-") || keyValue.startsWith("-")) {
    throw new UsageError("expected: couch remote press <target> <KEY>");
  }
  if (!REMOTE_KEY_SET.has(keyValue)) {
    throw new UsageError(`unknown remote key: ${keyValue}`);
  }

  let requestedTimes = 1;
  let json = false;
  for (let index = 4; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      if (json) throw new UsageError("--json may only be specified once");
      json = true;
      continue;
    }
    if (argument === "--times") {
      const value = args[++index];
      if (value === undefined) throw new UsageError("--times expects a positive integer");
      requestedTimes = parseTimes(value);
      continue;
    }
    throw new UsageError(`unknown option: ${argument}`);
  }

  return {
    command: "remote.press",
    targetId,
    key: keyValue as RemoteKey,
    requestedTimes,
    json,
  };
}

function removeSignalListener(
  target: CliSignalTarget,
  signal: "SIGINT" | "SIGTERM",
  listener: () => void,
): void {
  if (target.removeListener) target.removeListener(signal, listener);
  else target.off?.(signal, listener);
}

function errorDetails(error: unknown): CommandError {
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

function publicDeviceSummary(device: DeviceDescriptor): PublicDeviceSummary {
  return {
    id: device.id,
    name: device.name,
    platform: device.platform,
    ip: device.ip,
    ...(device.mac ? { mac: device.mac } : {}),
    ...(device.driverId ? { driverId: device.driverId } : {}),
  };
}

function abortable<T>(task: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  const settled = Promise.resolve(task);
  if (signal.aborted) {
    void settled.catch(() => undefined);
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    settled.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function signalMessage(signal: "SIGINT" | "SIGTERM"): string {
  return signal === "SIGINT" ? "Interrupted" : "Terminated";
}

function remediationFor(targetId: string, capability: OperationCapability): string {
  if (capability.support === "unsupported") {
    return "Choose a target and driver that support this operation.";
  }
  if (capability.readiness === "missing-tool") {
    return "Install the required device tool and ensure it is available on PATH, then rerun doctor.";
  }
  if (capability.readiness === "unauthorized") {
    return "Authorize this host on the device, then rerun doctor.";
  }
  if (capability.readiness === "offline") {
    return "Power on the device, confirm network reachability, then rerun doctor.";
  }
  if (capability.readiness === "misconfigured") {
    return "Update the device configuration or pairing credentials, then rerun doctor.";
  }
  if (capability.constraints?.readinessCheck === "paired-configuration-only") {
    return `Live connectivity was not checked; run \`couch remote press ${targetId} LEFT\` to verify control.`;
  }
  if (capability.support === "experimental") {
    return "Explicitly allow this experimental operation for the target before use.";
  }
  return "None.";
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function doctorCapabilities(
  targetId: string,
  capabilities: ReadonlyMap<OperationKind, OperationCapability>,
): readonly DoctorCapability[] {
  return [...capabilities]
    .sort(([left], [right]) => compareText(left, right))
    .map(([kind, capability]) => ({
      kind,
      ...capability,
      remediation: remediationFor(targetId, capability),
    }));
}

function readinessScope(
  capabilities: readonly DoctorCapability[],
): DeviceDoctorResult["readinessScope"] {
  if (
    capabilities.some(
      (capability) => capability.constraints?.readinessCheck === "paired-configuration-only",
    )
  ) {
    return "configuration-only";
  }
  if (
    capabilities.length > 0 &&
    capabilities.every((capability) => capability.constraints?.readinessCheck === "live-adb-probe")
  ) {
    return "live";
  }
  return "unknown";
}

function humanList(result: DeviceListResult): string {
  if (result.status !== "succeeded") return `device.list: ${result.status}\n`;
  if (result.devices.length === 0) return "No devices found.\n";
  const rows = result.devices.map((device) =>
    [device.id, device.name, device.platform, device.driverId ?? "-", device.ip].join("\t"),
  );
  return `${["ID\tNAME\tPLATFORM\tDRIVER\tADDRESS", ...rows].join("\n")}\n`;
}

function constraintText(constraints: DoctorCapability["constraints"]): string | undefined {
  if (!constraints) return undefined;
  return Object.entries(constraints)
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ");
}

function humanDoctor(result: DeviceDoctorResult): string {
  const lines = [`device.doctor ${result.targetId}: ${result.status}`];
  if (result.target) {
    lines.push(
      `target\t${result.target.name}\t${result.target.platform}\t${result.target.driverId ?? "-"}\t${result.target.ip}`,
    );
  }
  if (result.capabilities.length === 0) lines.push("No executable capabilities reported.");
  for (const capability of result.capabilities) {
    lines.push(`${capability.kind}\t${capability.support}\t${capability.readiness}`);
    if (capability.reason) lines.push(`  reason\t${capability.reason}`);
    const constraints = constraintText(capability.constraints);
    if (constraints) lines.push(`  constraints\t${constraints}`);
    lines.push(`  remediation\t${capability.remediation}`);
  }
  return `${lines.join("\n")}\n`;
}

function humanPress(result: PressResult): string {
  const operations = result.operations.map((operation) => {
    const confirmation = operation.confirmation ? ` (${operation.confirmation})` : "";
    return `${operation.ordinal}/${result.requestedTimes} ${result.key} ${operation.status}${confirmation}`;
  });
  const summary = `remote.press ${result.targetId}: ${result.status} (${result.operations.length}/${result.requestedTimes})`;
  return `${[...operations, summary].join("\n")}\n`;
}

function humanResult(result: CliResult): string {
  switch (result.command) {
    case "device.list":
      return humanList(result);
    case "device.doctor":
      return humanDoctor(result);
    case "remote.press":
      return humanPress(result);
  }
}

function writeResult(
  result: CliResult,
  json: boolean,
  stdout: (text: string) => void,
  stderr: (text: string) => void,
): void {
  stdout(json ? `${JSON.stringify(result)}\n` : humanResult(result));
  if (result.error) stderr(`${result.error.code}: ${result.error.message}\n`);
  if (result.cleanupError) stderr(`${result.cleanupError.code}: ${result.cleanupError.message}\n`);
}

function failureResult(
  command: ParsedCommand,
  error: CommandError,
  cleanupError?: CommandError,
  target?: PublicDeviceSummary,
): CliResult {
  const common = {
    resultVersion: 1 as const,
    status: "failed" as const,
    exitCode: FAILURE_EXIT as 2,
    error,
    ...(cleanupError ? { cleanupError } : {}),
  };
  switch (command.command) {
    case "device.list":
      return { ...common, command: "device.list", devices: [] };
    case "device.doctor":
      return {
        ...common,
        command: "device.doctor",
        targetId: command.targetId,
        ...(target ? { target } : {}),
        readinessScope: "unknown",
        capabilities: [],
      };
    case "remote.press":
      return {
        ...common,
        command: "remote.press",
        targetId: command.targetId,
        key: command.key,
        requestedTimes: command.requestedTimes,
        operations: [],
      };
  }
}

function cancelledResult(
  command: ParsedCommand,
  exitCode: 130 | 143,
  prior: CliResult | undefined,
  cleanupError?: CommandError,
  target?: PublicDeviceSummary,
): CliResult {
  const error = {
    code: "cancelled",
    message: signalMessage(exitCode === INTERRUPTED_EXIT ? "SIGINT" : "SIGTERM"),
  };
  const common = {
    resultVersion: 1 as const,
    status: "cancelled" as const,
    exitCode,
    error,
    ...(cleanupError ? { cleanupError } : {}),
  };
  switch (command.command) {
    case "device.list":
      return {
        ...common,
        command: "device.list",
        devices: prior?.command === "device.list" ? prior.devices : [],
      };
    case "device.doctor":
      return {
        ...common,
        command: "device.doctor",
        targetId: command.targetId,
        ...(target ? { target } : {}),
        readinessScope: prior?.command === "device.doctor" ? prior.readinessScope : "unknown",
        capabilities: prior?.command === "device.doctor" ? prior.capabilities : [],
      };
    case "remote.press":
      return {
        ...common,
        command: "remote.press",
        targetId: command.targetId,
        key: command.key,
        requestedTimes: command.requestedTimes,
        operations: prior?.command === "remote.press" ? prior.operations : [],
      };
  }
}

export async function runCli(
  args: readonly string[],
  dependencies: CliDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = dependencies.stderr ?? ((text: string) => process.stderr.write(text));

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    stdout(HELP);
    return 0;
  }

  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(args);
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
  let signalExit: 130 | 143 | undefined;
  let harness: DeviceHarness | undefined;
  let closePromise: Promise<void> | undefined;
  let closeError: CommandError | undefined;
  let caughtError: CommandError | undefined;
  let result: CliResult | undefined;
  let doctorTarget: PublicDeviceSummary | undefined;

  const closeHarness = (): Promise<void> => {
    if (!harness) return Promise.resolve();
    closePromise ??= Promise.resolve()
      .then(() => harness?.close())
      .then(() => undefined);
    return closePromise;
  };
  const cancel = (signal: "SIGINT" | "SIGTERM") => {
    signalExit ??= signal === "SIGINT" ? INTERRUPTED_EXIT : TERMINATED_EXIT;
    abortController.abort(new DOMException(signalMessage(signal), "AbortError"));
    void closeHarness().catch(() => undefined);
  };
  const onInterrupt = () => cancel("SIGINT");
  const onTerminate = () => cancel("SIGTERM");

  signalTarget.on("SIGINT", onInterrupt);
  signalTarget.on("SIGTERM", onTerminate);
  try {
    try {
      const runtime = await createRuntime({
        diagnosticSink: (event) => stderr(`${event.level}: ${event.message}\n`),
      });
      switch (parsed.command) {
        case "device.list": {
          const descriptors = await abortable(
            runtime.listDevices({ signal: abortController.signal }),
            abortController.signal,
          );
          const devices = descriptors
            .map(publicDeviceSummary)
            .sort((left, right) => compareText(left.id, right.id));
          result = {
            resultVersion: 1,
            command: "device.list",
            status: "succeeded",
            exitCode: 0,
            devices,
          };
          break;
        }
        case "device.doctor": {
          doctorTarget = publicDeviceSummary(
            await abortable(
              runtime.getDevice(parsed.targetId, { signal: abortController.signal }),
              abortController.signal,
            ),
          );
          const capabilities = doctorCapabilities(
            parsed.targetId,
            await abortable(
              runtime.getCapabilities(parsed.targetId, { signal: abortController.signal }),
              abortController.signal,
            ),
          );
          const ready =
            capabilities.length > 0 &&
            capabilities.every(
              (capability) => capability.readiness === "ready" && capability.support === "stable",
            );
          const scope = readinessScope(capabilities);
          const status = !ready
            ? "not-ready"
            : scope === "configuration-only"
              ? "unverified"
              : "ready";
          const doctorError =
            capabilities.length === 0
              ? {
                  code: "no-capabilities",
                  message: "No executable capabilities were reported for this target",
                }
              : status === "unverified"
                ? {
                    code: "live-readiness-unverified",
                    message: `Live connectivity was not checked for ${parsed.targetId}`,
                  }
                : status === "not-ready"
                  ? {
                      code: "target-not-ready",
                      message: `One or more capabilities are not ready for ${parsed.targetId}`,
                    }
                  : undefined;
          result = {
            resultVersion: 1,
            command: "device.doctor",
            targetId: parsed.targetId,
            target: doctorTarget,
            status,
            exitCode: status === "ready" ? 0 : FAILURE_EXIT,
            readinessScope: scope,
            capabilities,
            ...(doctorError ? { error: doctorError } : {}),
          };
          break;
        }
        case "remote.press": {
          harness = await runtime.openDevice(parsed.targetId, {
            require: ["control.press"],
            signal: abortController.signal,
          });
          const operations: OperationRecord[] = [];
          for (let ordinal = 0; ordinal < parsed.requestedTimes; ordinal += 1) {
            const operation = await harness.execute(
              { kind: "control.press", key: parsed.key },
              { signal: abortController.signal },
            );
            operations.push(operation);
            if (operation.status !== "succeeded") break;
          }
          const operationError = operations.at(-1)?.error;
          const operationStatus = operations.at(-1)?.status ?? "failed";
          result = {
            resultVersion: 1,
            command: "remote.press",
            targetId: parsed.targetId,
            key: parsed.key,
            requestedTimes: parsed.requestedTimes,
            status: operationStatus,
            exitCode: operationStatus === "succeeded" ? 0 : FAILURE_EXIT,
            operations,
            ...(operationError
              ? { error: { code: operationError.code, message: operationError.message } }
              : {}),
          };
          break;
        }
      }
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
    result = cancelledResult(parsed, signalExit, result, closeError, doctorTarget);
  } else if (caughtError) {
    result = failureResult(parsed, caughtError, closeError, doctorTarget);
  } else if (!result) {
    result = failureResult(
      parsed,
      closeError ?? { code: "runtime-failed", message: "Runtime produced no result" },
      undefined,
      doctorTarget,
    );
  } else if (closeError) {
    result = {
      ...result,
      status: "failed",
      exitCode: FAILURE_EXIT,
      error: closeError,
    } as CliResult;
  }

  writeResult(result, parsed.json, stdout, stderr);
  return result.exitCode;
}
