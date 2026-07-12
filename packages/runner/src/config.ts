import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isOperationKind, type OperationKind } from "@couch/device";
import { isRecord } from "./guards";
import type { VisualRectangle } from "./visual";

export interface VisualRegionConfig extends VisualRectangle {
  threshold?: number;
  maxDiffRatio?: number;
  ignoreRegions?: readonly VisualRectangle[];
}

export interface RenderingProfileConfig {
  width: number;
  height: number;
  baselineDirectory: string;
  threshold?: number;
  maxDiffRatio?: number;
  stableFrames?: number;
  maxAttempts?: number;
  pollIntervalMs?: number;
  regions: Record<string, VisualRegionConfig>;
}

export interface ResolvedRenderingProfileConfig {
  name: string;
  width: number;
  height: number;
  baselineDirectory: string;
  threshold: number;
  maxDiffRatio: number;
  stableFrames: number;
  maxAttempts: number;
  pollIntervalMs: number;
  regions: Record<string, VisualRegionConfig>;
}

export interface TestTargetConfig {
  deviceId: string;
  app: { id: string; activity?: string; artifact?: string };
  allowExperimental?: readonly OperationKind[];
  cleanup?: "stop" | "leave-running";
  artifactDirectory?: string;
  operationTimeoutMs?: number;
  foregroundTimeoutMs?: number;
  cleanupTimeoutMs?: number;
  visualProfile?: string;
  agent?: { settleMs: number };
}

export interface CouchTestConfig {
  configVersion: 1;
  ai?: { model: string; timeoutMs?: number };
  targets: Record<string, TestTargetConfig>;
  visualProfiles?: Record<string, RenderingProfileConfig>;
}

function validateAi(value: unknown): CouchTestConfig["ai"] {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("config.ai must be an object");
  assertKnownKeys(value, ["model", "timeoutMs"], "config.ai");
  const timeoutMs = positiveFinite(value.timeoutMs, "config.ai.timeoutMs");
  return {
    model: requiredString(value.model, "config.ai.model"),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

export interface ResolvedCouchTestConfig extends Omit<CouchTestConfig, "visualProfiles"> {
  visualProfiles: Record<string, ResolvedRenderingProfileConfig>;
}

const SECRET_KEYS =
  /(?:credential|password|token|secret|pairing|api.?key|client.?key|certificate|private.?key|(?:^|[_-]|device)ip$|address|mac)/i;

function assertKnownKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`${path}.${key} is not supported`);
  }
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, path);
}

function positiveFinite(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${path} must be a positive finite number`);
  }
  return value;
}

function finiteRange(value: unknown, path: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${path} must be between 0 and 1`);
  }
  return value;
}

function requiredPositiveInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`${path} must be a positive integer`);
  }
  return value as number;
}

function optionalPositiveInteger(value: unknown, path: string, fallback: number): number {
  return value === undefined ? fallback : requiredPositiveInteger(value, path);
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${path} must be a non-negative integer`);
  }
  return value as number;
}

function rectangle(value: unknown, path: string, bounds: { width: number; height: number }) {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  assertKnownKeys(value, ["x", "y", "width", "height"], path);
  const result = {
    x: nonNegativeInteger(value.x, `${path}.x`),
    y: nonNegativeInteger(value.y, `${path}.y`),
    width: requiredPositiveInteger(value.width, `${path}.width`),
    height: requiredPositiveInteger(value.height, `${path}.height`),
  };
  if (result.x + result.width > bounds.width || result.y + result.height > bounds.height) {
    throw new Error(`${path} must fit within the rendering profile`);
  }
  return result;
}

function validateVisualProfiles(value: unknown): Record<string, ResolvedRenderingProfileConfig> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error("config.visualProfiles must be an object");
  const profiles: Record<string, ResolvedRenderingProfileConfig> = {};
  for (const [name, raw] of Object.entries(value)) {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name) || name === "." || name === ".." || !isRecord(raw)) {
      throw new Error(`visualProfiles.${name} is invalid`);
    }
    assertKnownKeys(
      raw,
      [
        "width",
        "height",
        "baselineDirectory",
        "threshold",
        "maxDiffRatio",
        "stableFrames",
        "maxAttempts",
        "pollIntervalMs",
        "regions",
      ],
      `visualProfiles.${name}`,
    );
    const width = requiredPositiveInteger(raw.width, `visualProfiles.${name}.width`);
    const height = requiredPositiveInteger(raw.height, `visualProfiles.${name}.height`);
    if (!isRecord(raw.regions)) throw new Error(`visualProfiles.${name}.regions must be an object`);
    const regions: Record<string, VisualRegionConfig> = {};
    for (const [regionName, rawRegion] of Object.entries(raw.regions)) {
      if (!regionName.trim() || regionName === "." || regionName === "..") {
        throw new Error(`visualProfiles.${name} region name is invalid`);
      }
      if (!isRecord(rawRegion))
        throw new Error(`visualProfiles.${name}.regions.${regionName} must be an object`);
      assertKnownKeys(
        rawRegion,
        ["x", "y", "width", "height", "threshold", "maxDiffRatio", "ignoreRegions"],
        `visualProfiles.${name}.regions.${regionName}`,
      );
      const path = `visualProfiles.${name}.regions.${regionName}`;
      const base = rectangle(
        { x: rawRegion.x, y: rawRegion.y, width: rawRegion.width, height: rawRegion.height },
        path,
        { width, height },
      );
      const ignoreRegions = rawRegion.ignoreRegions;
      if (ignoreRegions !== undefined && !Array.isArray(ignoreRegions)) {
        throw new Error(`${path}.ignoreRegions must be an array`);
      }
      regions[regionName] = {
        ...base,
        ...(rawRegion.threshold === undefined
          ? {}
          : { threshold: finiteRange(rawRegion.threshold, `${path}.threshold`, 0) }),
        ...(rawRegion.maxDiffRatio === undefined
          ? {}
          : { maxDiffRatio: finiteRange(rawRegion.maxDiffRatio, `${path}.maxDiffRatio`, 0) }),
        ...(ignoreRegions === undefined
          ? {}
          : {
              ignoreRegions: ignoreRegions.map((mask, index) =>
                rectangle(mask, `${path}.ignoreRegions[${index}]`, { width, height }),
              ),
            }),
      };
    }
    const stableFrames = optionalPositiveInteger(
      raw.stableFrames,
      `visualProfiles.${name}.stableFrames`,
      2,
    );
    const maxAttempts = optionalPositiveInteger(
      raw.maxAttempts,
      `visualProfiles.${name}.maxAttempts`,
      5,
    );
    if (maxAttempts < stableFrames) {
      throw new Error(`visualProfiles.${name}.maxAttempts must cover stableFrames`);
    }
    profiles[name] = {
      name,
      width,
      height,
      baselineDirectory: requiredString(
        raw.baselineDirectory,
        `visualProfiles.${name}.baselineDirectory`,
      ),
      threshold: finiteRange(raw.threshold, `visualProfiles.${name}.threshold`, 0.1),
      maxDiffRatio: finiteRange(raw.maxDiffRatio, `visualProfiles.${name}.maxDiffRatio`, 0),
      stableFrames,
      maxAttempts,
      pollIntervalMs: optionalPositiveInteger(
        raw.pollIntervalMs,
        `visualProfiles.${name}.pollIntervalMs`,
        250,
      ),
      regions,
    };
  }
  return profiles;
}

function optionalOperationKinds(
  value: unknown,
  path: string,
): readonly OperationKind[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    !value.every((kind): kind is OperationKind => typeof kind === "string" && isOperationKind(kind))
  ) {
    throw new Error(`${path} has invalid allowExperimental operation`);
  }
  return value;
}

function assertNoCredentials(value: unknown, path = "config"): void {
  if (!isRecord(value) && !Array.isArray(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEYS.test(key))
      throw new Error(`${path}.${key} must not contain device credentials`);
    assertNoCredentials(child, `${path}.${key}`);
  }
}

function validateTarget(alias: string, rawTarget: Record<string, unknown>): TestTargetConfig {
  assertKnownKeys(
    rawTarget,
    [
      "deviceId",
      "app",
      "allowExperimental",
      "cleanup",
      "artifactDirectory",
      "operationTimeoutMs",
      "foregroundTimeoutMs",
      "cleanupTimeoutMs",
      "visualProfile",
      "agent",
    ],
    `targets.${alias}`,
  );

  const deviceId = requiredString(rawTarget.deviceId, `targets.${alias}.deviceId`);

  if (!isRecord(rawTarget.app)) throw new Error(`targets.${alias}.app must be an object`);
  assertKnownKeys(rawTarget.app, ["id", "activity", "artifact"], `targets.${alias}.app`);
  const appId = requiredString(rawTarget.app.id, `targets.${alias}.app.id`);
  const appActivity = optionalString(rawTarget.app.activity, `targets.${alias}.app.activity`);
  const appArtifact = optionalString(rawTarget.app.artifact, `targets.${alias}.app.artifact`);

  const cleanup = rawTarget.cleanup;
  if (cleanup !== undefined && cleanup !== "stop" && cleanup !== "leave-running") {
    throw new Error(`targets.${alias}.cleanup has invalid cleanup policy`);
  }

  const artifactDirectory = optionalString(
    rawTarget.artifactDirectory,
    `targets.${alias}.artifactDirectory`,
  );

  const allowExperimental = optionalOperationKinds(
    rawTarget.allowExperimental,
    `targets.${alias}.allowExperimental`,
  );

  const operationTimeoutMs = positiveFinite(
    rawTarget.operationTimeoutMs,
    `targets.${alias}.operationTimeoutMs`,
  );
  const foregroundTimeoutMs = positiveFinite(
    rawTarget.foregroundTimeoutMs,
    `targets.${alias}.foregroundTimeoutMs`,
  );
  const cleanupTimeoutMs = positiveFinite(
    rawTarget.cleanupTimeoutMs,
    `targets.${alias}.cleanupTimeoutMs`,
  );
  const visualProfile = optionalString(rawTarget.visualProfile, `targets.${alias}.visualProfile`);
  const agent = (() => {
    if (rawTarget.agent === undefined) return undefined;
    if (!isRecord(rawTarget.agent)) throw new Error(`targets.${alias}.agent must be an object`);
    assertKnownKeys(rawTarget.agent, ["settleMs"], `targets.${alias}.agent`);
    return {
      settleMs: nonNegativeInteger(rawTarget.agent.settleMs, `targets.${alias}.agent.settleMs`),
    };
  })();

  return {
    deviceId,
    app: {
      id: appId,
      ...(appActivity !== undefined ? { activity: appActivity } : {}),
      ...(appArtifact !== undefined ? { artifact: appArtifact } : {}),
    },
    ...(allowExperimental !== undefined ? { allowExperimental } : {}),
    ...(cleanup !== undefined ? { cleanup } : {}),
    ...(artifactDirectory !== undefined ? { artifactDirectory } : {}),
    ...(operationTimeoutMs !== undefined ? { operationTimeoutMs } : {}),
    ...(foregroundTimeoutMs !== undefined ? { foregroundTimeoutMs } : {}),
    ...(cleanupTimeoutMs !== undefined ? { cleanupTimeoutMs } : {}),
    ...(visualProfile !== undefined ? { visualProfile } : {}),
    ...(agent !== undefined ? { agent } : {}),
  };
}

export function validateConfig(value: unknown): ResolvedCouchTestConfig {
  assertNoCredentials(value);
  if (!isRecord(value)) throw new Error("couch.config.ts must export an object");
  assertKnownKeys(value, ["configVersion", "ai", "targets", "visualProfiles"], "config");
  if (value.configVersion !== 1) throw new Error("Unsupported couch configVersion");
  if (!isRecord(value.targets)) throw new Error("Config targets are required");

  const targets: Record<string, TestTargetConfig> = {};
  for (const [alias, rawTarget] of Object.entries(value.targets)) {
    if (!alias.trim() || alias === "." || alias === "..") {
      throw new Error("Invalid target alias");
    }
    if (!isRecord(rawTarget)) throw new Error(`targets.${alias} must be an object`);
    targets[alias] = validateTarget(alias, rawTarget);
  }
  const visualProfiles = validateVisualProfiles(value.visualProfiles);
  const ai = validateAi(value.ai);
  for (const [alias, target] of Object.entries(targets)) {
    if (target.visualProfile && !visualProfiles[target.visualProfile]) {
      throw new Error(`targets.${alias}.visualProfile was not found in visualProfiles`);
    }
  }
  return { configVersion: 1, ...(ai ? { ai } : {}), targets, visualProfiles };
}

export async function loadConfig(
  path = resolve("couch.config.ts"),
): Promise<ResolvedCouchTestConfig> {
  const module = await import(`${pathToFileURL(path).href}?run=${crypto.randomUUID()}`);
  return validateConfig(module.default);
}

export function resolveTarget(config: CouchTestConfig, alias: string): TestTargetConfig {
  const target = config.targets[alias];
  if (!target) throw new Error(`Target alias ${alias} was not found in couch.config.ts`);
  return target;
}
