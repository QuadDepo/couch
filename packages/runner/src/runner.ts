import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  ArtifactReference,
  DeviceDescriptor,
  DeviceInventory,
  DeviceSession,
  OperationKind,
  OperationRecord,
} from "@couch/device";
import type { LanguageModel } from "ai";
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
import { assertTvTestDefinition } from "./defineTvTest";
import { assertExitCodeAligns } from "./result";
import { AssertionFailure, buildTestContext, type ExecuteOperation } from "./testContext";

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
  metadata?: Record<string, unknown>;
}

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
  aiModel?: LanguageModel;
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

function requiredOperations(
  test: TvTestDefinition,
  platform: DeviceDescriptor["platform"],
  cleanup: TestTargetConfig["cleanup"],
): OperationKind[] {
  return [
    ...new Set<OperationKind>([
      ...(platform === "android-tv" || cleanup === "stop" ? (["app.stop"] as const) : []),
      ...test.requires,
    ]),
  ];
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

// A publication failure downgrades the result to infrastructure-failed, but an active
// SIGINT/SIGTERM stays authoritative: reapply cancellation precedence first so a cancelled
// run is never masked by a write failure.
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

  const trace: TestTrace = {
    traceVersion: 1,
    runId,
    targetAlias: options.targetAlias,
    startedAt,
    completedAt: new Date().toISOString(),
    operations,
    artifacts,
  };

  // runSessionCleanup already resolved any cancellation active at entry, so publish that verdict
  // directly. The only remaining race is a SIGINT/SIGTERM landing while these writes are in
  // flight: re-resolve precedence once after the writes and rewrite result.json if it changed.
  let result = params.result;
  assertExitCodeAligns(result);
  const resultPath = resolveContained(directory, "result.json");

  try {
    await publishJson(resolveContained(directory, "trace.json"), trace);
    if (device) {
      await publishJson(resolveContained(directory, "device.json"), publicDevice(device));
    }
    await publishText(
      resolveContained(directory, "diagnostics.log"),
      `${(options.diagnostics ?? []).join("\n")}\n`,
    );
    await publishJson(resultPath, result);
    const guarded = applyCancellationPrecedence(result, options);
    if (guarded !== result) {
      assertExitCodeAligns(guarded);
      await publishJson(resultPath, guarded);
      result = guarded;
    }
  } catch (error) {
    result = markArtifactPublicationFailure(result, error, options);
    assertExitCodeAligns(result);
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

  const leafName = basename(options.file) ?? "tv-test";
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
    const allowExperimental = target.allowExperimental ?? [];

    device = await inventory.getDevice(target.deviceId, { signal: options.signal });
    if (device.platform !== "android-tv" && device.platform !== "webos") {
      throw new Error("TV tests support Android TV and LG webOS targets only");
    }
    const requires = requiredOperations(test, device.platform, target.cleanup);
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
    if (device.platform === "android-tv") {
      await execute({ kind: "app.stop", appId: target.app.id }, true);
    }

    const context = buildTestContext({
      execute,
      target,
      directory,
      operations,
      assertions,
      artifacts,
      captureFormat: device.platform === "webos" ? "jpg" : "png",
      visualProfile: target.visualProfile
        ? config.visualProfiles?.[target.visualProfile]
        : undefined,
      aiModel: options.aiModel ?? config.ai?.model,
      aiTimeoutMs: config.ai?.timeoutMs,
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
