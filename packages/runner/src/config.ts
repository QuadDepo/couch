import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isOperationKind, type OperationKind } from "@couch/device";
import { isRecord } from "./guards";

export interface TestTargetConfig {
  deviceId: string;
  app: { id: string; activity?: string; artifact?: string };
  allowExperimental?: readonly OperationKind[];
  cleanup?: "stop" | "leave-running";
  artifactDirectory?: string;
  operationTimeoutMs?: number;
  foregroundTimeoutMs?: number;
  cleanupTimeoutMs?: number;
}

export interface CouchTestConfig {
  configVersion: 1;
  targets: Record<string, TestTargetConfig>;
}

const SECRET_KEYS =
  /(?:credential|password|token|secret|pairing|client.?key|certificate|private.?key|(?:^|[_-]|device)ip$|address|mac)/i;

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
  };
}

export function validateConfig(value: unknown): CouchTestConfig {
  assertNoCredentials(value);
  if (!isRecord(value)) throw new Error("couch.config.ts must export an object");
  assertKnownKeys(value, ["configVersion", "targets"], "config");
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
  return { configVersion: 1, targets };
}

export async function loadConfig(path = resolve("couch.config.ts")): Promise<CouchTestConfig> {
  const module = await import(`${pathToFileURL(path).href}?run=${crypto.randomUUID()}`);
  return validateConfig(module.default);
}

export function resolveTarget(config: CouchTestConfig, alias: string): TestTargetConfig {
  const target = config.targets[alias];
  if (!target) throw new Error(`Target alias ${alias} was not found in couch.config.ts`);
  return target;
}
