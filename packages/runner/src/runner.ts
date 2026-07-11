import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  ArtifactReference,
  DeviceDescriptor,
  DeviceInventory,
  DeviceSession,
  OperationKind,
  OperationRecord,
} from "@couch/device";
import { isOperationKind } from "@couch/device";
import {
  assertRealContained,
  prepareArtifactDirectory,
  publishJson,
  publishText,
  resolveContained,
  safeArtifactSegment,
} from "./artifacts";
import type { TestTargetConfig } from "./config";
import { loadConfig, resolveTarget } from "./config";
import type { TvTestContext, TvTestDefinition } from "./defineTvTest";
import { assertTvTestDefinition } from "./defineTvTest";

export interface TestTrace {
  traceVersion: 1;
  runId: string;
  // The alias the run was launched with (config key), not a device id.
  targetAlias: string;
  startedAt: string;
  completedAt: string;
  operations: readonly OperationRecord[];
  artifacts: readonly ArtifactReference[];
}

export interface TestResult {
  resultVersion: 1;
  status: "passed" | "failed" | "infrastructure-failed" | "cancelled";
  exitCode: 0 | 1 | 2 | 130 | 143;
  error?: { code: string; message: string };
  cleanupError?: { code: string; message: string };
  assertions: readonly AssertionRecord[];
}

export interface AssertionRecord {
  id: string;
  matcher: string;
  status: "passed" | "failed";
  operationIds: readonly string[];
  artifacts: readonly ArtifactReference[];
  error?: { code: string; message: string };
}

class AssertionFailure extends Error {}

const DEFAULT_FOREGROUND_TIMEOUT_MS = 10_000;
const FOREGROUND_POLL_INTERVAL_MS = 250;
const DEFAULT_CLEANUP_TIMEOUT_MS = 5_000;

export interface RunTvTestOptions {
  file: string;
  targetAlias: string;
  inventory: DeviceInventory | (() => Promise<DeviceInventory>);
  signal?: AbortSignal;
  signalExitCode?: () => 130 | 143 | undefined;
  configPath?: string;
  artifactDirectory?: string;
  diagnostics?: readonly string[];
}

function safeName(name: string): string {
  return safeArtifactSegment(name, "tv-test");
}

function testLeafDirectory(runDirectory: string, alias: string, leaf: string): string {
  return resolveContained(runDirectory, safeName(alias), safeName(leaf));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveWait, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolveWait();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

function requiredOperations(test: TvTestDefinition): OperationKind[] {
  return [...new Set<OperationKind>(["app.stop", ...test.requires])];
}

function withTimeout<T>(task: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolveTask, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolveTask(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function applyCancellationPrecedence(
  result: TestResult,
  options: Pick<RunTvTestOptions, "signal" | "signalExitCode">,
): TestResult {
  const signalCode = options.signalExitCode?.();
  if (!signalCode && !options.signal?.aborted) return result;
  const exitCode = signalCode ?? 130;
  const message =
    exitCode === 143
      ? "Terminated"
      : options.signal?.reason instanceof Error
        ? options.signal.reason.message
        : "Interrupted";
  if (
    result.status === "cancelled" &&
    result.exitCode === exitCode &&
    result.error?.code === "cancelled" &&
    result.error.message === message
  ) {
    return result;
  }
  return {
    ...result,
    status: "cancelled",
    exitCode,
    error: { code: "cancelled", message },
  };
}

async function loadTest(file: string): Promise<TvTestDefinition> {
  const imported: Record<string, unknown> = await import(
    `${pathToFileURL(resolve(file)).href}?run=${crypto.randomUUID()}`
  );
  const test = imported.default;
  assertTvTestDefinition(test);
  return test;
}

function publicDevice(device: DeviceDescriptor): Record<string, string> {
  return {
    id: device.id,
    name: device.name,
    platform: device.platform,
    ...(device.driverId ? { driverId: device.driverId } : {}),
  };
}

// --- Schema validation --------------------------------------------------------
// A tiny typed-guard combinator: every check reports the exact failing field path
// (e.g. "operations[3].startedAt is not an ISO timestamp") so validators cannot drift
// silently from the interfaces above.

class SchemaError extends Error {}

function withSchemaScope<T>(label: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof SchemaError) throw new Error(`${label}: ${error.message}`);
    throw error;
  }
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SchemaError(`${path} is not an object`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new SchemaError(`${path} is not an array`);
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") throw new SchemaError(`${path} is not a string`);
  return value;
}

function requireNonEmptyString(value: unknown, path: string): string {
  const text = requireString(value, path);
  if (!text) throw new SchemaError(`${path} must not be empty`);
  return text;
}

function requireNumber(value: unknown, path: string): number {
  if (typeof value !== "number") throw new SchemaError(`${path} is not a number`);
  return value;
}

function requirePositiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new SchemaError(`${path} is not a positive integer`);
  }
  return value;
}

function requireEnum<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new SchemaError(`${path} must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function requireIsoTimestamp(value: unknown, path: string): string {
  const text = requireString(value, path);
  if (!Number.isFinite(Date.parse(text))) {
    throw new SchemaError(`${path} is not an ISO timestamp`);
  }
  return text;
}

function requireErrorObject(value: unknown, path: string): void {
  const record = requireRecord(value, path);
  requireString(record.code, `${path}.code`);
  requireString(record.message, `${path}.message`);
}

function requireArtifacts(value: unknown, path: string): void {
  requireArray(value, path).forEach((artifact, index) => {
    const itemPath = `${path}[${index}]`;
    const record = requireRecord(artifact, itemPath);
    requireString(record.path, `${itemPath}.path`);
    if (record.id !== undefined) requireString(record.id, `${itemPath}.id`);
    if (record.type !== undefined) requireString(record.type, `${itemPath}.type`);
    if (record.mimeType !== undefined) requireString(record.mimeType, `${itemPath}.mimeType`);
    if (record.metadata !== undefined) requireRecord(record.metadata, `${itemPath}.metadata`);
  });
}

const RESULT_STATUSES = ["passed", "failed", "infrastructure-failed", "cancelled"] as const;
const ASSERTION_STATUSES = ["passed", "failed"] as const;
const OPERATION_STATUSES = ["succeeded", "failed", "cancelled"] as const;
const CONFIRMATIONS = ["process-exit", "protocol-response", "transport-write"] as const;
const OPERATION_ERROR_CATEGORIES = [
  "assertion",
  "infrastructure",
  "unsupported",
  "cancelled",
] as const;

const EXPECTED_EXIT: Record<TestResult["status"], number | readonly number[]> = {
  passed: 0,
  failed: 1,
  "infrastructure-failed": 2,
  cancelled: [130, 143],
};

function exitCodeAligns(status: TestResult["status"], exitCode: number): boolean {
  const expected = EXPECTED_EXIT[status];
  return Array.isArray(expected) ? expected.includes(exitCode) : exitCode === expected;
}

function assertAssertionRecord(value: unknown, path: string): void {
  const record = requireRecord(value, path);
  requireNonEmptyString(record.id, `${path}.id`);
  requireNonEmptyString(record.matcher, `${path}.matcher`);
  requireEnum(record.status, ASSERTION_STATUSES, `${path}.status`);
  requireArray(record.operationIds, `${path}.operationIds`).forEach((id, index) => {
    requireString(id, `${path}.operationIds[${index}]`);
  });
  requireArtifacts(record.artifacts, `${path}.artifacts`);
  if (record.error !== undefined) requireErrorObject(record.error, `${path}.error`);
}

function assertOperationError(value: unknown, path: string): void {
  const record = requireRecord(value, path);
  requireString(record.code, `${path}.code`);
  requireString(record.message, `${path}.message`);
  requireEnum(record.category, OPERATION_ERROR_CATEGORIES, `${path}.category`);
  if (typeof record.retryable !== "boolean") {
    throw new SchemaError(`${path}.retryable is not a boolean`);
  }
}

function assertOperationRecord(value: unknown, path: string): void {
  const record = requireRecord(value, path);
  requireNonEmptyString(record.id, `${path}.id`);
  requirePositiveInteger(record.ordinal, `${path}.ordinal`);
  if (typeof record.kind !== "string" || !isOperationKind(record.kind)) {
    throw new SchemaError(`${path}.kind is not a known operation kind`);
  }
  requireString(record.adapterId, `${path}.adapterId`);
  requireEnum(record.status, OPERATION_STATUSES, `${path}.status`);
  requireIsoTimestamp(record.startedAt, `${path}.startedAt`);
  requireIsoTimestamp(record.completedAt, `${path}.completedAt`);
  requireRecord(record.input, `${path}.input`);
  requireArtifacts(record.artifacts, `${path}.artifacts`);
  if (record.confirmation !== undefined) {
    requireEnum(record.confirmation, CONFIRMATIONS, `${path}.confirmation`);
  }
  if (record.error !== undefined) assertOperationError(record.error, `${path}.error`);
  if (record.metadata !== undefined) requireRecord(record.metadata, `${path}.metadata`);
}

export function validateTestResult(value: unknown): asserts value is TestResult {
  const { status, exitCode, assertions } = withSchemaScope("Invalid result schema", () => {
    const record = requireRecord(value, "result");
    if (record.resultVersion !== 1) throw new SchemaError("resultVersion must be 1");
    const status = requireEnum(record.status, RESULT_STATUSES, "status");
    const exitCode = requireNumber(record.exitCode, "exitCode");
    if (record.error !== undefined) requireErrorObject(record.error, "error");
    if (record.cleanupError !== undefined) requireErrorObject(record.cleanupError, "cleanupError");
    const assertions = requireArray(record.assertions, "assertions");
    return { status, exitCode, assertions };
  });

  if (!exitCodeAligns(status, exitCode)) {
    throw new Error(`Result status "${status}" and exitCode ${exitCode} do not align`);
  }

  assertions.forEach((assertion, index) => {
    withSchemaScope("Invalid assertion schema", () =>
      assertAssertionRecord(assertion, `assertions[${index}]`),
    );
  });
}

export function validateTestTrace(value: unknown): asserts value is TestTrace {
  const operations = withSchemaScope("Invalid trace schema", () => {
    const record = requireRecord(value, "trace");
    if (record.traceVersion !== 1) throw new SchemaError("traceVersion must be 1");
    requireNonEmptyString(record.runId, "runId");
    requireNonEmptyString(record.targetAlias, "targetAlias");
    requireIsoTimestamp(record.startedAt, "startedAt");
    requireIsoTimestamp(record.completedAt, "completedAt");
    const operations = requireArray(record.operations, "operations");
    requireArtifacts(record.artifacts, "artifacts");
    return operations;
  });

  operations.forEach((operation, index) => {
    withSchemaScope("Invalid operation record schema", () =>
      assertOperationRecord(operation, `operations[${index}]`),
    );
  });
}

// --- Execution ----------------------------------------------------------------

type ExecuteOperation = (
  operation: Parameters<DeviceSession["execute"]>[0],
  runnerOwned?: boolean,
) => Promise<OperationRecord>;

function createExecute(params: {
  session: DeviceSession;
  target: TestTargetConfig;
  declared: ReadonlySet<OperationKind>;
  operations: OperationRecord[];
  artifacts: ArtifactReference[];
  signal?: AbortSignal;
}): ExecuteOperation {
  const { session, target, declared, operations, artifacts, signal } = params;
  return async (operation, runnerOwned = false) => {
    if (!runnerOwned && !declared.has(operation.kind)) {
      throw new Error(`TV test used undeclared operation: ${operation.kind}`);
    }
    const record = await session.execute(operation, {
      signal,
      timeoutMs: target.operationTimeoutMs,
    });
    operations.push(record);
    artifacts.push(...record.artifacts);
    if (record.status !== "succeeded") {
      throw new Error(record.error?.message ?? `${record.kind} failed`);
    }
    return record;
  };
}

function recordAssertion(
  assertions: AssertionRecord[],
  matcher: string,
  passed: boolean,
  failureMessage: string,
  details: { operationIds?: readonly string[]; artifacts?: readonly ArtifactReference[] } = {},
): void {
  assertions.push({
    id: crypto.randomUUID(),
    matcher,
    status: passed ? "passed" : "failed",
    operationIds: details.operationIds ?? [],
    artifacts: details.artifacts ?? [],
    ...(passed ? {} : { error: { code: "assertion-failed", message: failureMessage } }),
  });
}

function buildTestContext(params: {
  execute: ExecuteOperation;
  target: TestTargetConfig;
  directory: string;
  operations: readonly OperationRecord[];
  assertions: AssertionRecord[];
  signal?: AbortSignal;
}): TvTestContext {
  const { execute, target, directory, operations, assertions, signal } = params;

  const foreground = async () => {
    const deadline = Date.now() + (target.foregroundTimeoutMs ?? DEFAULT_FOREGROUND_TIMEOUT_MS);
    while (true) {
      const record = await execute({ kind: "app.foreground", appId: target.app.id });
      if (record.metadata?.foreground === true) return record;
      if (Date.now() >= deadline) {
        const message = `${target.app.id} did not become foreground`;
        recordAssertion(assertions, "foreground", false, message, {
          operationIds: [record.id],
          artifacts: record.artifacts,
        });
        throw new AssertionFailure(message);
      }
      await wait(FOREGROUND_POLL_INTERVAL_MS, signal);
    }
  };

  return {
    tv: {
      app: {
        launch: () =>
          execute({
            kind: "app.launch",
            appId: target.app.id,
            activity: target.app.activity,
          }),
        foreground,
      },
      async press(key, pressOptions = {}) {
        const times = pressOptions.times ?? 1;
        for (let index = 0; index < times; index += 1) {
          await execute({ kind: "control.press", key });
          if (pressOptions.intervalMs && index + 1 < times) {
            await wait(pressOptions.intervalMs, signal);
          }
        }
      },
      screen: {
        capture: (name = "actual.png") =>
          execute({
            kind: "screen.capture",
            format: "png",
            path: resolveContained(directory, safeName(name)),
          }),
      },
    },
    expect: {
      foreground(record) {
        const candidate = record ?? operations.findLast((item) => item.kind === "app.foreground");
        const passed = candidate?.metadata?.foreground === true;
        recordAssertion(assertions, "foreground", passed, "Configured app is not foreground", {
          operationIds: candidate ? [candidate.id] : [],
          artifacts: candidate?.artifacts ?? [],
        });
        if (!passed) throw new AssertionFailure("Configured app is not foreground");
      },
      equal(actual, expected, message) {
        const passed = Object.is(actual, expected);
        const failureMessage =
          message ?? `Expected ${String(expected)}, received ${String(actual)}`;
        recordAssertion(assertions, "equal", passed, failureMessage);
        if (!passed) throw new AssertionFailure(failureMessage);
      },
    },
  };
}

function classifyFailure(
  error: unknown,
  assertions: readonly AssertionRecord[],
  options: RunTvTestOptions,
): TestResult {
  const signalCode = options.signalExitCode?.();
  const cancelled = options.signal?.aborted || signalCode !== undefined;
  const assertion = error instanceof AssertionFailure;
  return {
    resultVersion: 1,
    status: cancelled ? "cancelled" : assertion ? "failed" : "infrastructure-failed",
    exitCode: cancelled ? (signalCode ?? 130) : assertion ? 1 : 2,
    error: {
      code: cancelled ? "cancelled" : assertion ? "assertion-failed" : "infrastructure-failed",
      message: errorMessage(error),
    },
    assertions,
  };
}

async function runSessionCleanup(params: {
  session: DeviceSession | undefined;
  target: TestTargetConfig | undefined;
  operations: OperationRecord[];
  artifacts: ArtifactReference[];
  result: TestResult;
  options: RunTvTestOptions;
}): Promise<TestResult> {
  const { session, target, operations, artifacts, options } = params;
  let result = params.result;

  if (session && target?.cleanup === "stop") {
    try {
      const cleanupOperationTimeoutMs = target.operationTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS;
      const cleanupRecord = await withTimeout(
        session.execute(
          { kind: "app.stop", appId: target.app.id },
          { timeoutMs: cleanupOperationTimeoutMs },
        ),
        cleanupOperationTimeoutMs,
        "App cleanup timed out",
      );
      operations.push(cleanupRecord);
      artifacts.push(...cleanupRecord.artifacts);
      if (cleanupRecord.status !== "succeeded") {
        result.cleanupError = {
          code: cleanupRecord.error?.code ?? "cleanup-failed",
          message: cleanupRecord.error?.message ?? "Configured app cleanup failed",
        };
      }
    } catch (error) {
      result.cleanupError = { code: "cleanup-failed", message: errorMessage(error) };
    }
  }

  if (session) {
    const sessionCloseTimeoutMs = target?.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS;
    await withTimeout(session.close(), sessionCloseTimeoutMs, "Session close timed out").catch(
      (error) => {
        result.cleanupError = { code: "session-cleanup-failed", message: errorMessage(error) };
      },
    );
  }

  result = applyCancellationPrecedence(result, options);
  if (result.cleanupError && result.status === "passed") {
    result = {
      ...result,
      status: "infrastructure-failed",
      exitCode: 2,
      error: { code: result.cleanupError.code, message: result.cleanupError.message },
    };
  }
  return result;
}

// Publication treats an active SIGINT/SIGTERM as authoritative: every write is followed by
// applyCancellationPrecedence so a signal that arrives mid-write wins in the persisted result.
function markArtifactPublicationFailure(
  result: TestResult,
  error: unknown,
  options: RunTvTestOptions,
): TestResult {
  const guarded = applyCancellationPrecedence(result, options);
  if (guarded.status === "cancelled") return guarded;
  return {
    ...guarded,
    status: "infrastructure-failed",
    exitCode: 2,
    error: { code: "artifact-publication-failed", message: errorMessage(error) },
  };
}

async function finalizeAndPublish(params: {
  result: TestResult;
  directory: string;
  runId: string;
  startedAt: string;
  operations: readonly OperationRecord[];
  artifacts: readonly ArtifactReference[];
  device: DeviceDescriptor | undefined;
  options: RunTvTestOptions;
}): Promise<{ result: TestResult; trace: TestTrace }> {
  const { directory, runId, startedAt, operations, artifacts, device, options } = params;
  let result = params.result;

  const trace: TestTrace = {
    traceVersion: 1,
    runId,
    targetAlias: options.targetAlias,
    startedAt,
    completedAt: new Date().toISOString(),
    operations,
    artifacts,
  };
  validateTestTrace(trace);
  result = applyCancellationPrecedence(result, options);
  validateTestResult(result);

  try {
    await publishJson(resolveContained(directory, "trace.json"), trace);
    result = applyCancellationPrecedence(result, options);
    if (device) {
      await publishJson(resolveContained(directory, "device.json"), publicDevice(device));
      result = applyCancellationPrecedence(result, options);
    }
    await publishText(
      resolveContained(directory, "diagnostics.log"),
      `${(options.diagnostics ?? []).join("\n")}\n`,
    );
    result = applyCancellationPrecedence(result, options);
  } catch (error) {
    result = markArtifactPublicationFailure(result, error, options);
    validateTestResult(result);
  }

  const resultPath = resolveContained(directory, "result.json");
  result = applyCancellationPrecedence(result, options);
  validateTestResult(result);
  try {
    await publishJson(resultPath, result);
    const publishedResult = result;
    result = applyCancellationPrecedence(result, options);
    if (result !== publishedResult) {
      validateTestResult(result);
      await publishJson(resultPath, result);
    }
  } catch (error) {
    result = markArtifactPublicationFailure(result, error, options);
    validateTestResult(result);
    await publishJson(resultPath, result).catch(() => undefined);
  }

  return { result, trace };
}

export async function runTvTest(
  options: RunTvTestOptions,
): Promise<{ result: TestResult; trace?: TestTrace; artifactDirectory?: string }> {
  const startedAt = new Date().toISOString();
  const runId = crypto.randomUUID();
  const operations: OperationRecord[] = [];
  const artifacts: ArtifactReference[] = [];
  const assertions: AssertionRecord[] = [];
  let session: DeviceSession | undefined;
  let directory: string | undefined;
  let result: TestResult = {
    resultVersion: 1,
    status: "infrastructure-failed",
    exitCode: 2,
    error: { code: "infrastructure-failed", message: "Run did not start" },
    assertions,
  };
  let target: TestTargetConfig | undefined;
  let device: DeviceDescriptor | undefined;

  const leafName = options.file.split("/").at(-1) ?? "tv-test";
  try {
    let runDirectory = resolve(options.artifactDirectory ?? "artifacts", runId);
    directory = testLeafDirectory(runDirectory, options.targetAlias, leafName);

    const config = await loadConfig(options.configPath);
    target = resolveTarget(config, options.targetAlias);
    if (!options.artifactDirectory && target.artifactDirectory) {
      runDirectory = resolve(target.artifactDirectory, runId);
      directory = testLeafDirectory(runDirectory, options.targetAlias, leafName);
    }

    const test = await loadTest(options.file);
    directory = testLeafDirectory(runDirectory, options.targetAlias, test.name);
    await prepareArtifactDirectory(directory);
    await assertRealContained(runDirectory, directory);

    const inventory =
      typeof options.inventory === "function" ? await options.inventory() : options.inventory;
    const requires = requiredOperations(test);
    const allowExperimental = target.allowExperimental ?? [];

    device = await inventory.getDevice(target.deviceId, { signal: options.signal });
    if (device.platform !== "android-tv") {
      throw new Error("Phase 3 supports Android TV targets only");
    }
    session = await inventory.openSession(target.deviceId, {
      require: requires,
      allowExperimental,
      signal: options.signal,
    });

    const execute = createExecute({
      session,
      target,
      declared: new Set(test.requires),
      operations,
      artifacts,
      signal: options.signal,
    });
    await execute({ kind: "app.stop", appId: target.app.id }, true);

    const context = buildTestContext({
      execute,
      target,
      directory,
      operations,
      assertions,
      signal: options.signal,
    });
    await test.run(context);
    result = { resultVersion: 1, status: "passed", exitCode: 0, assertions };
  } catch (error) {
    if (directory) {
      const failureDirectory = directory;
      await prepareArtifactDirectory(failureDirectory)
        .then(() => assertRealContained(resolve(failureDirectory, "..", ".."), failureDirectory))
        .catch(() => {
          directory = undefined;
        });
    }
    result = classifyFailure(error, assertions, options);
  } finally {
    result = await runSessionCleanup({ session, target, operations, artifacts, result, options });
  }

  if (directory) {
    const { result: publishedResult, trace } = await finalizeAndPublish({
      result,
      directory,
      runId,
      startedAt,
      operations,
      artifacts,
      device,
      options,
    });
    return { result: publishedResult, trace, artifactDirectory: directory };
  }
  return { result };
}
