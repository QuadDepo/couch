import { access, readFile, unlink } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { ArtifactReference, DeviceSession, OperationRecord } from "@couch/device";
import type { LanguageModel } from "ai";
import {
  assertRealContained,
  publishBytes,
  publishJson,
  publishText,
  resolveContained,
  safeArtifactSegment,
} from "./artifacts";
import type { ResolvedRenderingProfileConfig, TestTargetConfig } from "./config";
import type { TvTestContext, VisualRegionOptions } from "./defineTvTest";
import { emitRunEvent, sanitizeEventText, type TestEventObserver } from "./events";
import { runNavigationAgent } from "./navigationAgent";
import type { AssertionRecord, TestResultErrorStage } from "./runner";
import { answerScreenQuestion } from "./screenQuestion";
import {
  comparablePixelCount,
  compareVisualFiles,
  type ImageDimensions,
  ignoredOutsideRegion,
  imageDimensions,
  VISUAL_COMPARATOR,
  type VisualComparison,
  type VisualRectangle,
} from "./visual";

export class AssertionFailure extends Error {}

const DEFAULT_FOREGROUND_TIMEOUT_MS = 10_000;
const FOREGROUND_POLL_INTERVAL_MS = 250;

export type ExecuteOperation = (
  operation: Parameters<DeviceSession["execute"]>[0],
  runnerOwned?: boolean,
) => Promise<OperationRecord>;

function safeName(name: string): string {
  return safeArtifactSegment(name, "tv-test");
}

function captureName(name: string, format: "png" | "jpg"): string {
  const safe = safeName(name);
  const extension = extname(safe).toLowerCase();
  if (!extension) return `${safe}.${format}`;
  const valid =
    format === "png" ? extension === ".png" : extension === ".jpg" || extension === ".jpeg";
  if (!valid) throw new Error(`screen.capture filename must use a .${format} extension`);
  return safe;
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

function recordAssertion(
  assertions: AssertionRecord[],
  matcher: string,
  passed: boolean,
  failureMessage: string,
  details: {
    operationIds?: readonly string[];
    artifacts?: readonly ArtifactReference[];
    errorCode?: string;
    metadata?: Record<string, unknown>;
    onEvent?: TestEventObserver;
  } = {},
): void {
  const assertion: AssertionRecord = {
    id: crypto.randomUUID(),
    matcher,
    status: passed ? "passed" : "failed",
    operationIds: details.operationIds ?? [],
    artifacts: details.artifacts ?? [],
    ...(passed
      ? {}
      : { error: { code: details.errorCode ?? "assertion-failed", message: failureMessage } }),
    ...(details.metadata ? { metadata: details.metadata } : {}),
  };
  assertions.push(assertion);
  emitRunEvent(details.onEvent, {
    type: "assertion",
    assertion: {
      id: assertion.id,
      matcher: assertion.matcher,
      label: sanitizeEventText(failureMessage, assertion.matcher),
      status: assertion.status,
      ...(assertion.error ? { error: assertion.error } : {}),
    },
    at: new Date().toISOString(),
  });
}

function validateVisualOptions(
  options: VisualRegionOptions,
  profile: ResolvedRenderingProfileConfig,
): readonly VisualRectangle[] {
  for (const [name, value] of [
    ["threshold", options.threshold],
    ["maxDiffRatio", options.maxDiffRatio],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) {
      throw new Error(`visualRegion ${name} must be between 0 and 1`);
    }
  }
  return (options.ignoreRegions ?? []).map((rectangle, index) => {
    if (
      !Number.isInteger(rectangle.x) ||
      !Number.isInteger(rectangle.y) ||
      !Number.isInteger(rectangle.width) ||
      !Number.isInteger(rectangle.height) ||
      rectangle.x < 0 ||
      rectangle.y < 0 ||
      rectangle.width <= 0 ||
      rectangle.height <= 0 ||
      rectangle.x + rectangle.width > profile.width ||
      rectangle.y + rectangle.height > profile.height
    ) {
      throw new Error(`visualRegion ignoreRegions[${index}] must fit within the profile`);
    }
    return rectangle;
  });
}

function visualArtifact(
  path: string,
  role: "expected" | "actual" | "diff",
  mimeType: string,
): ArtifactReference {
  return { path, type: `visual-${role}`, mimeType, metadata: { role } };
}

export function buildTestContext(params: {
  execute: ExecuteOperation;
  target: TestTargetConfig;
  directory: string;
  operations: readonly OperationRecord[];
  assertions: AssertionRecord[];
  artifacts: ArtifactReference[];
  visualProfile?: ResolvedRenderingProfileConfig;
  captureFormat?: "png" | "jpg";
  aiModel?: LanguageModel;
  aiTimeoutMs?: number;
  signal?: AbortSignal;
  onStageChange?: (stage?: TestResultErrorStage) => void;
  onEvent?: TestEventObserver;
}): TvTestContext {
  const {
    execute,
    target,
    directory,
    operations,
    assertions,
    artifacts,
    visualProfile,
    aiModel,
    aiTimeoutMs = 15_000,
    signal,
    captureFormat = "png",
    onStageChange,
    onEvent,
  } = params;

  const capture = (name: string) =>
    execute({
      kind: "screen.capture",
      format: captureFormat,
      path: resolveContained(directory, captureName(name, captureFormat)),
    });
  let screenQuestionCount = 0;
  let agentRunCount = 0;
  let completedAgentRun = false;

  const visualRegion = async (name: string, options: VisualRegionOptions) => {
    const failInfrastructure = (
      code: string,
      message: string,
      details: {
        operationIds?: readonly string[];
        artifacts?: readonly ArtifactReference[];
        metadata?: Record<string, unknown>;
      } = {},
    ): never => {
      recordAssertion(assertions, "visualRegion", false, message, {
        ...details,
        errorCode: code,
        onEvent,
      });
      throw new Error(message);
    };
    const profile = visualProfile;
    if (!profile) {
      return failInfrastructure(
        "visual-profile-missing",
        "Target does not configure a visualProfile",
      );
    }
    const region = profile.regions[options.region];
    if (!region) {
      return failInfrastructure(
        "visual-region-missing",
        `Visual region ${options.region} was not found in ${profile.name}`,
      );
    }
    const dynamicMasks = (() => {
      try {
        return validateVisualOptions(options, profile);
      } catch (error) {
        return failInfrastructure(
          "visual-options-invalid",
          error instanceof Error ? error.message : String(error),
        );
      }
    })();
    const threshold = options.threshold ?? region.threshold ?? profile.threshold;
    const maxDiffRatio = options.maxDiffRatio ?? region.maxDiffRatio ?? profile.maxDiffRatio;
    const masks = [...(region.ignoreRegions ?? []), ...dynamicMasks];
    const comparablePixels = comparablePixelCount(region, masks);
    if (comparablePixels === 0) {
      return failInfrastructure(
        "visual-options-invalid",
        `Visual region ${options.region} is completely masked`,
      );
    }
    const ignoreRegions = [...ignoredOutsideRegion(profile, region), ...masks];
    const baselineDirectory = resolve(profile.baselineDirectory);
    const baselineRoot = (() => {
      try {
        return resolveContained(baselineDirectory, profile.name);
      } catch {
        return failInfrastructure(
          "visual-baseline-outside-root",
          `Visual profile ${profile.name} escapes its configured baseline directory`,
        );
      }
    })();
    const safe = safeName(name);
    const operationIds: string[] = [];
    const readVisualFile = async (path: string, role: "baseline" | "capture") => {
      try {
        return await readFile(path);
      } catch {
        return failInfrastructure(
          role === "baseline" ? "visual-baseline-unreadable" : "visual-capture-unreadable",
          `Visual ${role} cannot be read: ${path}`,
          { operationIds },
        );
      }
    };
    const probeDimensions = (bytes: Uint8Array) => {
      try {
        return { dimensions: imageDimensions(bytes) };
      } catch (error) {
        return { dimensionError: error instanceof Error ? error.message : String(error) };
      }
    };
    const captureFrame = async (attempt: number) => {
      const record = await capture(`${safe}-capture-${attempt}.${captureFormat}`);
      operationIds.push(record.id);
      const path = resolveContained(directory, `${safe}-capture-${attempt}.${captureFormat}`);
      const bytes = await readVisualFile(path, "capture");
      return { path, bytes, ...probeDimensions(bytes) };
    };

    const baselinePath = resolveContained(baselineRoot, `${safe}.${captureFormat}`);
    let actualFrame = await captureFrame(1);
    try {
      await access(baselinePath);
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
      failInfrastructure(
        missing ? "visual-baseline-missing" : "visual-baseline-unreadable",
        missing
          ? `Visual baseline is missing: ${baselinePath}`
          : `Visual baseline cannot be accessed: ${baselinePath}`,
        { operationIds },
      );
    }
    try {
      await assertRealContained(baselineRoot, baselinePath);
    } catch {
      failInfrastructure(
        "visual-baseline-outside-root",
        `Visual baseline escapes its configured directory: ${baselinePath}`,
        { operationIds },
      );
    }

    const expectedArtifactPath = resolveContained(directory, `${safe}-expected.${captureFormat}`);
    const actualArtifactPath = resolveContained(directory, `${safe}-actual.${captureFormat}`);
    const diffPath = resolveContained(directory, `${safe}-diff.png`);
    const baselineBytes = await readVisualFile(baselinePath, "baseline");
    const baselineProbe = probeDimensions(baselineBytes);
    const expectedArtifact = visualArtifact(
      expectedArtifactPath,
      "expected",
      captureFormat === "png" ? "image/png" : "image/jpeg",
    );
    const actualArtifact = visualArtifact(
      actualArtifactPath,
      "actual",
      captureFormat === "png" ? "image/png" : "image/jpeg",
    );
    const publishPair = async (actualBytes: Uint8Array) => {
      await Promise.all([
        publishBytes(expectedArtifactPath, baselineBytes),
        publishBytes(actualArtifactPath, actualBytes),
      ]);
      artifacts.push(expectedArtifact, actualArtifact);
      return [expectedArtifact, actualArtifact] as const;
    };
    const validateDimensions = async (
      role: "baseline" | "capture",
      probe: { dimensions?: ImageDimensions; dimensionError?: string },
      frameBytes: Uint8Array,
    ) => {
      if (probe.dimensionError) {
        const assertionArtifacts = await publishPair(frameBytes);
        return failInfrastructure("visual-image-dimensions-invalid", probe.dimensionError, {
          operationIds,
          artifacts: assertionArtifacts,
        });
      }
      if (probe.dimensions?.width !== profile.width || probe.dimensions.height !== profile.height) {
        const assertionArtifacts = await publishPair(frameBytes);
        return failInfrastructure(
          "visual-layout-mismatch",
          `Visual ${role} is ${probe.dimensions?.width}x${probe.dimensions?.height}, expected ${profile.width}x${profile.height}`,
          { operationIds, artifacts: assertionArtifacts },
        );
      }
    };
    await validateDimensions("baseline", baselineProbe, actualFrame.bytes);
    await validateDimensions("capture", actualFrame, actualFrame.bytes);

    let previousFrame = actualFrame;
    let stableCount = 1;
    for (
      let attempt = 2;
      attempt <= profile.maxAttempts && stableCount < profile.stableFrames;
      attempt += 1
    ) {
      await wait(profile.pollIntervalMs, signal);
      const currentFrame = await captureFrame(attempt);
      await validateDimensions("capture", currentFrame, currentFrame.bytes);
      const stabilityDiff = resolveContained(directory, `.${safe}-stability-${attempt}.png`);
      let comparison: VisualComparison;
      try {
        comparison = await compareVisualFiles({
          expectedPath: previousFrame.path,
          actualPath: currentFrame.path,
          diffPath: stabilityDiff,
          threshold,
          ignoreRegions,
          comparablePixels,
          signal,
        });
      } catch (error) {
        signal?.throwIfAborted();
        return failInfrastructure(
          "visual-comparison-failed",
          error instanceof Error ? error.message : String(error),
          { operationIds },
        );
      }
      await unlink(stabilityDiff).catch(() => undefined);
      if (comparison.reason === "layout-diff") {
        const assertionArtifacts = await publishPair(currentFrame.bytes);
        return failInfrastructure(
          "visual-layout-mismatch",
          "Captured frames have inconsistent dimensions",
          { operationIds, artifacts: assertionArtifacts },
        );
      }
      stableCount = comparison.match || comparison.diffRatio <= maxDiffRatio ? stableCount + 1 : 1;
      previousFrame = currentFrame;
      actualFrame = currentFrame;
    }
    if (stableCount < profile.stableFrames) {
      return failInfrastructure(
        "visual-unstable-capture",
        `Visual region ${options.region} did not stabilize`,
        { operationIds },
      );
    }

    await publishPair(actualFrame.bytes);
    let comparison: VisualComparison;
    try {
      comparison = await compareVisualFiles({
        expectedPath: baselinePath,
        actualPath: actualFrame.path,
        diffPath,
        threshold,
        ignoreRegions,
        comparablePixels,
        signal,
      });
    } catch (error) {
      signal?.throwIfAborted();
      return failInfrastructure(
        "visual-comparison-failed",
        error instanceof Error ? error.message : String(error),
        {
          operationIds,
          artifacts: [expectedArtifact, actualArtifact],
          metadata: {
            comparator: VISUAL_COMPARATOR.name,
            comparatorVersion: VISUAL_COMPARATOR.version,
          },
        },
      );
    }
    if (comparison.reason === "layout-diff") {
      const message = `Visual baseline and capture dimensions differ for ${profile.name}`;
      const assertionArtifacts = [expectedArtifact, actualArtifact];
      recordAssertion(assertions, "visualRegion", false, message, {
        operationIds,
        onEvent,
        artifacts: assertionArtifacts,
        errorCode: "visual-layout-mismatch",
        metadata: {
          profile: profile.name,
          region: options.region,
          comparator: VISUAL_COMPARATOR.name,
          comparatorVersion: VISUAL_COMPARATOR.version,
        },
      });
      throw new Error(message);
    }
    const passed = comparison.match || comparison.diffRatio <= maxDiffRatio;
    const diffArtifact = visualArtifact(diffPath, "diff", "image/png");
    const assertionArtifacts = passed
      ? [expectedArtifact, actualArtifact]
      : [expectedArtifact, actualArtifact, diffArtifact];
    if (passed && !comparison.match) await unlink(diffPath).catch(() => undefined);
    if (!passed) artifacts.push(diffArtifact);
    const metadata = {
      profile: profile.name,
      region: options.region,
      threshold,
      maxDiffRatio,
      diffCount: comparison.diffCount,
      diffRatio: comparison.diffRatio,
      diffPercentage: comparison.diffRatio * 100,
      ignoreRegions,
      comparablePixels,
      comparator: VISUAL_COMPARATOR.name,
      comparatorVersion: VISUAL_COMPARATOR.version,
    };
    const message = `Visual region ${options.region} differs by ${comparison.diffRatio}`;
    recordAssertion(assertions, "visualRegion", passed, message, {
      operationIds,
      artifacts: assertionArtifacts,
      metadata,
      onEvent,
    });
    if (!passed) throw new AssertionFailure(message);
  };

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
          onEvent,
        });
        throw new AssertionFailure(message);
      }
      await wait(FOREGROUND_POLL_INTERVAL_MS, signal);
    }
  };

  return {
    tv: {
      agent: {
        async run(goal, options = {}) {
          onStageChange?.("agent-startup");
          if (!aiModel) {
            emitRunEvent(onEvent, {
              type: "agent-start",
              goal: sanitizeEventText(goal, "Navigation goal"),
              maxSteps: options.maxSteps ?? 20,
              at: new Date().toISOString(),
            });
            emitRunEvent(onEvent, {
              type: "agent-failure",
              stage: "agent-startup",
              reason: "tv.agent.run requires AI model configuration",
              at: new Date().toISOString(),
            });
            throw new Error("tv.agent.run requires AI model configuration");
          }
          agentRunCount += 1;
          onStageChange?.("agent-run");
          let captureCount = 0;
          const result = await runNavigationAgent(
            {
              execute,
              async capture() {
                captureCount += 1;
                const name = `agent-run-${agentRunCount}-screen-${captureCount}`;
                const record = await capture(name);
                const path = resolveContained(directory, captureName(name, captureFormat));
                return {
                  record,
                  bytes: new Uint8Array(await readFile(path)),
                  mediaType: captureFormat === "jpg" ? "image/jpeg" : "image/png",
                };
              },
              model: aiModel,
              signal,
              onEvent,
              timeoutMs: aiTimeoutMs,
              settleMs: target.agent?.settleMs,
              async publishArtifact(value) {
                const path = resolveContained(directory, `agent-run-${agentRunCount}.json`);
                await publishJson(path, value);
                artifacts.push({ path, type: "agent-run", mimeType: "application/json" });
              },
              async publishLog(value) {
                const path = resolveContained(directory, `agent-run-${agentRunCount}.log`);
                await publishText(path, value);
                artifacts.push({ path, type: "agent-run-log", mimeType: "text/plain" });
              },
            },
            { goal, ...options },
          );
          if (result.status !== "completed") {
            if (result.terminationReason.startsWith("model-")) {
              throw new Error(result.reason);
            }
            throw new AssertionFailure(result.reason);
          }
          completedAgentRun = true;
          onStageChange?.();
        },
      },
      app: {
        launch: () =>
          execute({
            kind: "app.launch",
            appId: target.app.id,
            ...(target.app.activity ? { activity: target.app.activity } : {}),
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
        capture: (name = `actual.${captureFormat}`) => capture(name),
        async ask(options) {
          onStageChange?.(completedAgentRun ? "post-agent-assertion" : "pre-agent-screen-question");
          if (!aiModel) {
            emitRunEvent(onEvent, {
              type: "screen-question-start",
              question: sanitizeEventText(options.question, "Screen question"),
              at: new Date().toISOString(),
            });
            emitRunEvent(onEvent, {
              type: "screen-question-finish",
              status: "failed",
              error: { message: "tv.screen.ask requires AI model configuration" },
              at: new Date().toISOString(),
            });
            throw new Error("tv.screen.ask requires AI model configuration");
          }
          screenQuestionCount += 1;
          const path = resolveContained(
            directory,
            captureName(`screen-question-${screenQuestionCount}`, captureFormat),
          );
          emitRunEvent(onEvent, {
            type: "screen-question-start",
            question: sanitizeEventText(options.question, "Screen question"),
            at: new Date().toISOString(),
          });
          try {
            await capture(`screen-question-${screenQuestionCount}`);
            const result = await answerScreenQuestion({
              image: new Uint8Array(await readFile(path)),
              mediaType: captureFormat === "jpg" ? "image/jpeg" : "image/png",
              question: options.question,
              output: options.output,
              model: aiModel,
              timeoutMs: aiTimeoutMs,
              signal,
            });
            emitRunEvent(onEvent, {
              type: "screen-question-finish",
              status: "succeeded",
              modelId: result.modelId,
              result: sanitizeEventText(JSON.stringify(result.output), "answered"),
              at: new Date().toISOString(),
            });
            if (!completedAgentRun) onStageChange?.();
            return result;
          } catch (error) {
            emitRunEvent(onEvent, {
              type: "screen-question-finish",
              status: "failed",
              error: {
                message: sanitizeEventText(
                  error instanceof Error ? error.message : error,
                  "Screen question failed",
                ),
              },
              at: new Date().toISOString(),
            });
            throw error;
          }
        },
      },
    },
    expect: {
      foreground(record) {
        const candidate = record ?? operations.findLast((item) => item.kind === "app.foreground");
        const passed = candidate?.metadata?.foreground === true;
        recordAssertion(assertions, "foreground", passed, "Configured app is not foreground", {
          operationIds: candidate ? [candidate.id] : [],
          artifacts: candidate?.artifacts ?? [],
          onEvent,
        });
        if (!passed) throw new AssertionFailure("Configured app is not foreground");
      },
      equal(actual, expected, message) {
        const passed = Object.is(actual, expected);
        const failureMessage =
          message ?? `Expected ${String(expected)}, received ${String(actual)}`;
        recordAssertion(assertions, "equal", passed, failureMessage, { onEvent });
        if (!passed) throw new AssertionFailure(failureMessage);
      },
      poll(actual, options = {}) {
        const attempts = options.attempts ?? 3;
        const intervalMs = options.intervalMs ?? 1_000;
        if (!Number.isInteger(attempts) || attempts <= 0) {
          throw new Error("expect.poll attempts must be a positive integer");
        }
        if (!Number.isFinite(intervalMs) || intervalMs < 0) {
          throw new Error("expect.poll intervalMs must be a non-negative number");
        }
        return {
          async equal(expected, message) {
            let observed: typeof expected;
            for (let attempt = 1; attempt <= attempts; attempt += 1) {
              signal?.throwIfAborted();
              observed = await actual();
              signal?.throwIfAborted();
              if (Object.is(observed, expected)) {
                recordAssertion(assertions, "poll.equal", true, message ?? "Values are equal", {
                  onEvent,
                });
                return;
              }
              if (attempt < attempts) {
                emitRunEvent(onEvent, {
                  type: "poll-retry",
                  attempt,
                  attempts,
                  intervalMs,
                  at: new Date().toISOString(),
                });
                await wait(intervalMs, signal);
              }
            }
            const failureMessage =
              message ?? `Expected ${String(expected)}, received ${String(observed!)}`;
            recordAssertion(assertions, "poll.equal", false, failureMessage, { onEvent });
            throw new AssertionFailure(failureMessage);
          },
        };
      },
      visualRegion,
    },
  };
}
