import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isOperationKind, type OperationKind } from "@couch/device";

export interface TestTargetConfig {
  deviceId: string;
  app: { id: string; activity: string; artifact?: string };
  adapters?: { control: string; lifecycle?: string; observation?: string };
  renderingProfile?: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertKnownKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`${path}.${key} is not supported`);
  }
}

function positiveFinite(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${path} must be a positive finite number`);
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

export function validateConfig(value: unknown): CouchTestConfig {
  assertNoCredentials(value);
  if (!isRecord(value)) throw new Error("couch.config.ts must export an object");
  assertKnownKeys(value, ["configVersion", "targets"], "config");
  if (value.configVersion !== 1) throw new Error("Unsupported couch configVersion");
  if (!isRecord(value.targets)) throw new Error("Config targets are required");
  const targets: Record<string, TestTargetConfig> = {};
  for (const [alias, rawTarget] of Object.entries(value.targets)) {
    if (!alias.trim() || alias === "." || alias === ".." || !isRecord(rawTarget)) {
      throw new Error("Invalid target alias");
    }
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
        "adapters",
        "renderingProfile",
      ],
      `targets.${alias}`,
    );
    if (typeof rawTarget.deviceId !== "string" || !rawTarget.deviceId.trim()) {
      throw new Error(`Target ${alias} requires deviceId`);
    }
    if (!isRecord(rawTarget.app)) throw new Error(`Target ${alias} requires app`);
    assertKnownKeys(rawTarget.app, ["id", "activity", "artifact"], `targets.${alias}.app`);
    if (typeof rawTarget.app.id !== "string" || !rawTarget.app.id.trim()) {
      throw new Error(`Target ${alias} requires app.id`);
    }
    if (typeof rawTarget.app.activity !== "string" || !rawTarget.app.activity.trim()) {
      throw new Error(`Target ${alias} requires app.activity`);
    }
    if (
      rawTarget.app.artifact !== undefined &&
      (typeof rawTarget.app.artifact !== "string" || !rawTarget.app.artifact.trim())
    ) {
      throw new Error(`Target ${alias} has invalid app.artifact`);
    }
    if (
      rawTarget.cleanup !== undefined &&
      rawTarget.cleanup !== "stop" &&
      rawTarget.cleanup !== "leave-running"
    ) {
      throw new Error(`Target ${alias} has invalid cleanup policy`);
    }
    if (
      rawTarget.artifactDirectory !== undefined &&
      (typeof rawTarget.artifactDirectory !== "string" || !rawTarget.artifactDirectory.trim())
    ) {
      throw new Error(`Target ${alias} has invalid artifactDirectory`);
    }
    if (
      rawTarget.allowExperimental !== undefined &&
      (!Array.isArray(rawTarget.allowExperimental) ||
        rawTarget.allowExperimental.some(
          (kind) => typeof kind !== "string" || !isOperationKind(kind),
        ))
    ) {
      throw new Error(`Target ${alias} has invalid allowExperimental operation`);
    }
    if (rawTarget.adapters !== undefined) {
      if (!isRecord(rawTarget.adapters)) throw new Error(`Target ${alias} has invalid adapters`);
      assertKnownKeys(
        rawTarget.adapters,
        ["control", "lifecycle", "observation"],
        `targets.${alias}.adapters`,
      );
      for (const key of ["control", "lifecycle", "observation"] as const) {
        const adapter = rawTarget.adapters[key];
        if (
          (key === "control" || adapter !== undefined) &&
          (typeof adapter !== "string" || !adapter.trim())
        ) {
          throw new Error(`Target ${alias} has invalid adapters.${key}`);
        }
      }
    }
    if (
      rawTarget.renderingProfile !== undefined &&
      (typeof rawTarget.renderingProfile !== "string" || !rawTarget.renderingProfile.trim())
    ) {
      throw new Error(`Target ${alias} has invalid renderingProfile`);
    }
    targets[alias] = {
      deviceId: rawTarget.deviceId,
      app: {
        id: rawTarget.app.id,
        activity: rawTarget.app.activity,
        ...(typeof rawTarget.app.artifact === "string" ? { artifact: rawTarget.app.artifact } : {}),
      },
      ...(isRecord(rawTarget.adapters)
        ? {
            adapters: {
              control: rawTarget.adapters.control as string,
              ...(typeof rawTarget.adapters.lifecycle === "string"
                ? { lifecycle: rawTarget.adapters.lifecycle }
                : {}),
              ...(typeof rawTarget.adapters.observation === "string"
                ? { observation: rawTarget.adapters.observation }
                : {}),
            },
          }
        : {}),
      ...(typeof rawTarget.renderingProfile === "string"
        ? { renderingProfile: rawTarget.renderingProfile }
        : {}),
      ...(rawTarget.allowExperimental
        ? { allowExperimental: rawTarget.allowExperimental as OperationKind[] }
        : {}),
      ...(rawTarget.cleanup ? { cleanup: rawTarget.cleanup } : {}),
      ...(typeof rawTarget.artifactDirectory === "string"
        ? { artifactDirectory: rawTarget.artifactDirectory }
        : {}),
      ...(positiveFinite(rawTarget.operationTimeoutMs, `targets.${alias}.operationTimeoutMs`) !==
      undefined
        ? { operationTimeoutMs: rawTarget.operationTimeoutMs as number }
        : {}),
      ...(positiveFinite(rawTarget.foregroundTimeoutMs, `targets.${alias}.foregroundTimeoutMs`) !==
      undefined
        ? { foregroundTimeoutMs: rawTarget.foregroundTimeoutMs as number }
        : {}),
      ...(positiveFinite(rawTarget.cleanupTimeoutMs, `targets.${alias}.cleanupTimeoutMs`) !==
      undefined
        ? { cleanupTimeoutMs: rawTarget.cleanupTimeoutMs as number }
        : {}),
    };
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
