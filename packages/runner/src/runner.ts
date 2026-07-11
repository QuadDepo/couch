import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  ArtifactReference,
  DeviceDescriptor,
  DeviceInventory,
  DeviceSession,
  OperationKind,
  OperationRecord,
  RemoteKey,
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
import type { TvTestDefinition } from "./defineTvTest";
import { preflight } from "./preflight";

export interface TestTrace {
  traceVersion: 1;
  runId: string;
  targetId: string;
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
  const module = await import(`${pathToFileURL(resolve(file)).href}?run=${crypto.randomUUID()}`);
  const test = module.default as TvTestDefinition | undefined;
  if (!test?.name || !Array.isArray(test.requires) || typeof test.run !== "function") {
    throw new Error("TV test must default-export defineTvTest({...})");
  }
  if (test.requires.some((kind) => typeof kind !== "string" || !isOperationKind(kind))) {
    throw new Error("TV test requires contains an unknown operation");
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validError(value: unknown): boolean {
  return isRecord(value) && typeof value.code === "string" && typeof value.message === "string";
}

function validArtifacts(value: unknown): value is readonly ArtifactReference[] {
  return (
    Array.isArray(value) &&
    value.every(
      (artifact) =>
        isRecord(artifact) &&
        typeof artifact.path === "string" &&
        (artifact.id === undefined || typeof artifact.id === "string") &&
        (artifact.type === undefined || typeof artifact.type === "string") &&
        (artifact.mimeType === undefined || typeof artifact.mimeType === "string") &&
        (artifact.metadata === undefined || isRecord(artifact.metadata)),
    )
  );
}

export function validateTestResult(value: unknown): asserts value is TestResult {
  const expectedExit = {
    passed: 0,
    failed: 1,
    "infrastructure-failed": 2,
    cancelled: [130, 143],
  } as const;
  if (
    !isRecord(value) ||
    value.resultVersion !== 1 ||
    !["passed", "failed", "infrastructure-failed", "cancelled"].includes(String(value.status)) ||
    typeof value.exitCode !== "number" ||
    !Array.isArray(value.assertions) ||
    (value.error !== undefined && !validError(value.error)) ||
    (value.cleanupError !== undefined && !validError(value.cleanupError))
  ) {
    throw new Error("Invalid result schema");
  }
  const result = value as unknown as TestResult;
  const exit = expectedExit[result.status];
  if (
    Array.isArray(exit) ? !exit.includes(result.exitCode as 130 | 143) : result.exitCode !== exit
  ) {
    throw new Error("Result status and exitCode do not align");
  }
  for (const assertion of result.assertions) {
    if (
      !assertion.id ||
      !assertion.matcher ||
      !["passed", "failed"].includes(assertion.status) ||
      !Array.isArray(assertion.operationIds) ||
      assertion.operationIds.some((id) => typeof id !== "string") ||
      !validArtifacts(assertion.artifacts) ||
      (assertion.error !== undefined && !validError(assertion.error))
    ) {
      throw new Error("Invalid assertion schema");
    }
  }
}

export function validateTestTrace(value: unknown): asserts value is TestTrace {
  if (
    !isRecord(value) ||
    value.traceVersion !== 1 ||
    typeof value.runId !== "string" ||
    !value.runId ||
    typeof value.targetId !== "string" ||
    !value.targetId ||
    typeof value.startedAt !== "string" ||
    !Number.isFinite(Date.parse(value.startedAt)) ||
    typeof value.completedAt !== "string" ||
    !Number.isFinite(Date.parse(value.completedAt)) ||
    !Array.isArray(value.operations) ||
    !validArtifacts(value.artifacts)
  ) {
    throw new Error("Invalid trace schema");
  }
  const trace = value as unknown as TestTrace;
  for (const operation of trace.operations) {
    if (
      !operation.id ||
      !Number.isInteger(operation.ordinal) ||
      operation.ordinal < 1 ||
      !isOperationKind(operation.kind) ||
      typeof operation.adapterId !== "string" ||
      !["succeeded", "failed", "cancelled"].includes(operation.status) ||
      typeof operation.startedAt !== "string" ||
      !Number.isFinite(Date.parse(operation.startedAt)) ||
      typeof operation.completedAt !== "string" ||
      !Number.isFinite(Date.parse(operation.completedAt)) ||
      !isRecord(operation.input) ||
      !validArtifacts(operation.artifacts) ||
      (operation.confirmation !== undefined &&
        !["process-exit", "protocol-response", "transport-write"].includes(
          operation.confirmation,
        )) ||
      (operation.error !== undefined &&
        (!validError(operation.error) ||
          !["assertion", "infrastructure", "unsupported", "cancelled"].includes(
            operation.error.category,
          ) ||
          typeof operation.error.retryable !== "boolean")) ||
      (operation.metadata !== undefined && !isRecord(operation.metadata))
    ) {
      throw new Error("Invalid operation record schema");
    }
  }
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
  let test: TvTestDefinition | undefined;
  let device: DeviceDescriptor | undefined;
  let inventory: DeviceInventory | undefined;
  try {
    let runDirectory = resolve(options.artifactDirectory ?? "artifacts", runId);
    directory = resolveContained(
      runDirectory,
      safeName(options.targetAlias),
      safeName(options.file.split("/").at(-1) ?? "tv-test"),
    );
    const config = await loadConfig(options.configPath);
    target = resolveTarget(config, options.targetAlias);
    if (!options.artifactDirectory && target.artifactDirectory) {
      runDirectory = resolve(target.artifactDirectory, runId);
      directory = resolveContained(
        runDirectory,
        safeName(options.targetAlias),
        safeName(options.file.split("/").at(-1) ?? "tv-test"),
      );
    }
    test = await loadTest(options.file);
    directory = resolveContained(runDirectory, safeName(options.targetAlias), safeName(test.name));
    await prepareArtifactDirectory(directory);
    await assertRealContained(runDirectory, directory);
    inventory =
      typeof options.inventory === "function" ? await options.inventory() : options.inventory;
    const requires = requiredOperations(test);
    const allowExperimental = target.allowExperimental ?? [];
    device = await inventory.getDevice(target.deviceId, { signal: options.signal });
    if (device.platform !== "android-tv") {
      throw new Error("Phase 3 supports Android TV targets only");
    }
    await preflight(inventory, target.deviceId, requires, allowExperimental, options.signal);
    session = await inventory.openSession(target.deviceId, {
      require: requires,
      allowExperimental,
      signal: options.signal,
    });
    const activeSession = session;
    const activeTarget = target;
    const activeDirectory = directory;
    const declared = new Set(test.requires);
    const execute = async (
      operation: Parameters<DeviceSession["execute"]>[0],
      runnerOwned = false,
    ) => {
      if (!runnerOwned && !declared.has(operation.kind)) {
        throw new Error(`TV test used undeclared operation: ${operation.kind}`);
      }
      const record = await activeSession.execute(operation, {
        signal: options.signal,
        timeoutMs: activeTarget.operationTimeoutMs,
      });
      operations.push(record);
      artifacts.push(...record.artifacts);
      if (record.status !== "succeeded")
        throw new Error(record.error?.message ?? `${record.kind} failed`);
      return record;
    };
    await execute({ kind: "app.stop", appId: target.app.id }, true);
    const foreground = async () => {
      const deadline = Date.now() + (activeTarget.foregroundTimeoutMs ?? 10_000);
      while (true) {
        const record = await execute({ kind: "app.foreground", appId: activeTarget.app.id });
        if (record.metadata?.foreground === true) return record;
        if (Date.now() >= deadline) {
          const message = `${activeTarget.app.id} did not become foreground`;
          assertions.push({
            id: crypto.randomUUID(),
            matcher: "foreground",
            status: "failed",
            operationIds: [record.id],
            artifacts: record.artifacts,
            error: { code: "assertion-failed", message },
          });
          throw new AssertionFailure(message);
        }
        await wait(250, options.signal);
      }
    };
    const context = {
      tv: {
        app: {
          launch: () =>
            execute({
              kind: "app.launch",
              appId: activeTarget.app.id,
              activity: activeTarget.app.activity,
            }),
          foreground,
        },
        async press(key: RemoteKey, pressOptions: { times?: number; intervalMs?: number } = {}) {
          for (let index = 0; index < (pressOptions.times ?? 1); index += 1) {
            await execute({ kind: "control.press", key });
            if (pressOptions.intervalMs && index + 1 < (pressOptions.times ?? 1)) {
              await wait(pressOptions.intervalMs, options.signal);
            }
          }
        },
        screen: {
          capture: (name = "actual.png") =>
            execute({
              kind: "screen.capture",
              format: "png",
              path: resolveContained(activeDirectory, safeName(name)),
            }),
        },
      },
      expect: {
        foreground(record?: OperationRecord) {
          const candidate = record ?? operations.findLast((item) => item.kind === "app.foreground");
          const passed = candidate?.metadata?.foreground === true;
          assertions.push({
            id: crypto.randomUUID(),
            matcher: "foreground",
            status: passed ? "passed" : "failed",
            operationIds: candidate ? [candidate.id] : [],
            artifacts: candidate?.artifacts ?? [],
            ...(!passed
              ? { error: { code: "assertion-failed", message: "Configured app is not foreground" } }
              : {}),
          });
          if (!passed) throw new AssertionFailure("Configured app is not foreground");
        },
        equal<T>(actual: T, expected: T, message?: string) {
          const passed = Object.is(actual, expected);
          const errorMessage =
            message ?? `Expected ${String(expected)}, received ${String(actual)}`;
          assertions.push({
            id: crypto.randomUUID(),
            matcher: "equal",
            status: passed ? "passed" : "failed",
            operationIds: [],
            artifacts: [],
            ...(!passed ? { error: { code: "assertion-failed", message: errorMessage } } : {}),
          });
          if (!passed) throw new AssertionFailure(errorMessage);
        },
      },
    };
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
    const signalCode = options.signalExitCode?.();
    const cancelled = options.signal?.aborted || signalCode !== undefined;
    const assertion = error instanceof AssertionFailure;
    result = {
      resultVersion: 1,
      status: cancelled ? "cancelled" : assertion ? "failed" : "infrastructure-failed",
      exitCode: cancelled ? (signalCode ?? 130) : assertion ? 1 : 2,
      error: {
        code: cancelled ? "cancelled" : assertion ? "assertion-failed" : "infrastructure-failed",
        message: error instanceof Error ? error.message : String(error),
      },
      assertions,
    };
  } finally {
    if (session && target?.cleanup === "stop") {
      try {
        const cleanupTimeoutMs = target.operationTimeoutMs ?? 5_000;
        const cleanupRecord = await withTimeout(
          session.execute(
            { kind: "app.stop", appId: target.app.id },
            { timeoutMs: cleanupTimeoutMs },
          ),
          cleanupTimeoutMs,
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
        result.cleanupError = { code: "cleanup-failed", message: String(error) };
      }
    }
    if (session) {
      const closeTimeoutMs = target?.cleanupTimeoutMs ?? 5_000;
      await withTimeout(session.close(), closeTimeoutMs, "Session close timed out").catch(
        (error) => {
          result.cleanupError = { code: "session-cleanup-failed", message: String(error) };
        },
      );
    }
    result = applyCancellationPrecedence(result, options);
    if (result.cleanupError && result.status === "passed") {
      result = {
        ...result,
        status: "infrastructure-failed",
        exitCode: 2,
        error: {
          code: result.cleanupError.code,
          message: result.cleanupError.message,
        },
      };
    }
  }
  if (directory) {
    const trace: TestTrace = {
      traceVersion: 1,
      runId,
      targetId: options.targetAlias,
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
      result = applyCancellationPrecedence(result, options);
      if (result.status !== "cancelled") {
        result = {
          ...result,
          status: "infrastructure-failed",
          exitCode: 2,
          error: { code: "artifact-publication-failed", message: String(error) },
        };
      }
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
      result = applyCancellationPrecedence(result, options);
      if (result.status !== "cancelled") {
        result = {
          ...result,
          status: "infrastructure-failed",
          exitCode: 2,
          error: { code: "artifact-publication-failed", message: String(error) },
        };
      }
      validateTestResult(result);
      await publishJson(resultPath, result).catch(() => undefined);
    }
    return { result, trace, artifactDirectory: directory };
  }
  return { result };
}
