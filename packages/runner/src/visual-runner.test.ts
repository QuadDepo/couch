import { expect, test } from "bun:test";
import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  DeviceInventory,
  DeviceOperation,
  DeviceSession,
  OperationRecord,
  ProductPlatform,
} from "@couch/device";
import { runTvTest } from "./runner";

const BLACK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const WHITE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1xQAAAAASUVORK5CYII=",
  "base64",
);
const BLACK_10X10 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKAQAAAAClSfIQAAAAC0lEQVQI12NgwAcAAB4AAW6FRzIAAAAASUVORK5CYII=",
  "base64",
);
const WHITE_10X10 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKAQAAAAClSfIQAAAADklEQVQI12P4f4ABNwIAB1IRd+bI0OMAAAAASUVORK5CYII=",
  "base64",
);
const ONE_WHITE_10X10 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKAQAAAAClSfIQAAAADElEQVQI12NoYMADAA6eAIGgMO3nAAAAAElFTkSuQmCC",
  "base64",
);
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAAB//8AAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AACwgAAQABAQERAP/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//dAAQAAf/aAAgBAQAAPwD8A6//2Q==",
  "base64",
);

async function runVisual(options: {
  platform?: ProductPlatform;
  baseline?: Uint8Array;
  capture?: Uint8Array;
  captures?: readonly Uint8Array[];
  ignore?: boolean;
  stableFrames?: number;
  maxAttempts?: number;
  signal?: AbortSignal;
  abort?: () => void;
  baselineLink?: string;
  profileName?: string;
  profileSize?: number;
  regionSize?: number;
  maxDiffRatio?: number;
  configureTargetProfile?: boolean;
  assertionRegion?: string;
  assertionThreshold?: number;
}) {
  const platform = options.platform ?? "android-tv";
  const format = platform === "webos" ? "jpg" : "png";
  const root = await mkdtemp(join(tmpdir(), "couch-visual-runner-"));
  const baselineRoot = join(root, "baselines");
  const profileName = options.profileName ?? "profile";
  const profileRoot = join(baselineRoot, profileName.includes("/") ? "profile" : profileName);
  await mkdir(profileRoot, { recursive: true });
  if (options.baseline) await Bun.write(join(profileRoot, `screen.${format}`), options.baseline);
  if (options.baselineLink) {
    await symlink(options.baselineLink, join(profileRoot, `screen.${format}`));
  }
  const configPath = join(root, "couch.config.ts");
  await Bun.write(
    configPath,
    `export default { configVersion: 1, targets: { lab: { deviceId: "tv", app: { id: "app" }${options.configureTargetProfile === false ? "" : `, visualProfile: ${JSON.stringify(profileName)}`}${platform === "webos" ? ', allowExperimental: ["screen.capture"]' : ""} } }, visualProfiles: { [${JSON.stringify(profileName)}]: { width: ${options.profileSize ?? 1}, height: ${options.profileSize ?? 1}, baselineDirectory: ${JSON.stringify(baselineRoot)}, stableFrames: ${options.stableFrames ?? 1}, maxAttempts: ${options.maxAttempts ?? 5}, pollIntervalMs: 1, maxDiffRatio: ${options.maxDiffRatio ?? 0}, regions: { content: { x: 0, y: 0, width: ${options.regionSize ?? 1}, height: ${options.regionSize ?? 1}${options.ignore ? ", ignoreRegions: [{ x: 0, y: 0, width: 1, height: 1 }]" : ""} } } } } };`,
  );
  const testPath = join(root, "visual.tv.ts");
  await Bun.write(
    testPath,
    `export default { name: "visual", requires: ["screen.capture"], async run({ expect }) { await expect.visualRegion("screen", { region: ${JSON.stringify(options.assertionRegion ?? "content")}${options.assertionThreshold === undefined ? "" : `, threshold: ${options.assertionThreshold}`} }); } };`,
  );
  const records: OperationRecord[] = [];
  let captureIndex = 0;
  const session: DeviceSession = {
    capabilities: new Map(),
    async execute(operation: DeviceOperation) {
      if (operation.kind === "screen.capture") {
        options.abort?.();
        options.signal?.throwIfAborted();
        if (!operation.path) throw new Error("capture path missing");
        const capture =
          options.captures?.[captureIndex] ?? options.capture ?? options.baseline ?? BLACK_PNG;
        captureIndex += 1;
        await Bun.write(operation.path, capture);
      }
      const record: OperationRecord = {
        id: `operation-${records.length + 1}`,
        ordinal: records.length + 1,
        kind: operation.kind,
        adapterId: platform === "webos" ? "lg-ssap" : "adb",
        status: "succeeded",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        input: operation,
        artifacts:
          operation.kind === "screen.capture" && operation.path
            ? [{ path: operation.path, type: "screenshot" }]
            : [],
      };
      records.push(record);
      return record;
    },
    close: async () => undefined,
  };
  const inventory: DeviceInventory = {
    listDevices: async () => [],
    getDevice: async () => ({ id: "tv", name: "TV", platform, ip: "192.0.2.1" }),
    getCapabilities: async () => new Map(),
    openSession: async () => session,
  };
  const outcome = await runTvTest({
    file: testPath,
    targetAlias: "lab",
    inventory,
    configPath,
    artifactDirectory: join(root, "artifacts"),
    signal: options.signal,
  });
  return { outcome, records };
}

test("passes Android visual regions with deterministic metrics", async () => {
  const { outcome, records } = await runVisual({ baseline: BLACK_PNG });
  expect(outcome.result.status).toBe("passed");
  expect(records.find((record) => record.kind === "screen.capture")?.input.format).toBe("png");
  expect(outcome.result.assertions[0]).toMatchObject({
    matcher: "visualRegion",
    status: "passed",
    metadata: {
      profile: "profile",
      region: "content",
      diffCount: 0,
      diffRatio: 0,
      diffPercentage: 0,
    },
  });
});

test("classifies pixel mismatches as assertion failures and publishes a diff", async () => {
  const { outcome } = await runVisual({ baseline: BLACK_PNG, capture: WHITE_PNG });
  expect(outcome.result).toMatchObject({ status: "failed", exitCode: 1 });
  expect(outcome.result.assertions[0]).toMatchObject({
    status: "failed",
    metadata: { diffCount: 1, diffRatio: 1 },
  });
  expect(outcome.result.assertions[0]?.artifacts.map((artifact) => artifact.type)).toEqual([
    "visual-expected",
    "visual-actual",
    "visual-diff",
  ]);
});

test("classifies missing baselines and layout mismatches as infrastructure failures", async () => {
  const missing = await runVisual({ capture: BLACK_PNG });
  expect(missing.outcome.result).toMatchObject({ status: "infrastructure-failed", exitCode: 2 });
  expect(missing.outcome.result.assertions[0]?.error?.code).toBe("visual-baseline-missing");

  const layout = await runVisual({
    baseline: BLACK_PNG,
    capture: Bun.file(join(import.meta.dir, "../../../test.png")),
  });
  expect(layout.outcome.result).toMatchObject({ status: "infrastructure-failed", exitCode: 2 });
  expect(layout.outcome.result.assertions[0]?.error?.code).toBe("visual-layout-mismatch");
});

test("applies configured masks and supports webOS JPEG captures", async () => {
  expect(
    (
      await runVisual({
        baseline: BLACK_10X10,
        capture: ONE_WHITE_10X10,
        profileSize: 10,
        regionSize: 10,
        ignore: true,
      })
    ).outcome.result.status,
  ).toBe("passed");
  const webos = await runVisual({ platform: "webos", baseline: JPEG });
  expect(webos.outcome.result.status).toBe("passed");
  expect(webos.records.find((record) => record.kind === "screen.capture")?.input.format).toBe(
    "jpg",
  );
});

test("polls for stable frames and rejects captures that never stabilize", async () => {
  const stable = await runVisual({
    baseline: WHITE_PNG,
    captures: [BLACK_PNG, WHITE_PNG, WHITE_PNG],
    stableFrames: 2,
    maxAttempts: 3,
  });
  expect(stable.outcome.result.status).toBe("passed");
  expect(stable.records.filter((record) => record.kind === "screen.capture")).toHaveLength(3);

  const unstable = await runVisual({
    baseline: BLACK_PNG,
    captures: [BLACK_PNG, WHITE_PNG, BLACK_PNG],
    stableFrames: 2,
    maxAttempts: 3,
  });
  expect(unstable.outcome.result.status).toBe("infrastructure-failed");
  expect(unstable.outcome.result.assertions[0]?.error?.code).toBe("visual-unstable-capture");
});

test("uses named-region pixels for assertion and stability ratios", async () => {
  const mismatch = await runVisual({
    baseline: BLACK_10X10,
    capture: WHITE_10X10,
    profileSize: 10,
    regionSize: 1,
    maxDiffRatio: 0.02,
  });
  expect(mismatch.outcome.result.status).toBe("failed");
  expect(mismatch.outcome.result.assertions[0]?.metadata).toMatchObject({
    comparablePixels: 1,
    diffCount: 1,
    diffRatio: 1,
  });

  const stable = await runVisual({
    baseline: WHITE_10X10,
    captures: [BLACK_10X10, WHITE_10X10, WHITE_10X10],
    profileSize: 10,
    regionSize: 1,
    maxDiffRatio: 0.02,
    stableFrames: 2,
    maxAttempts: 3,
  });
  expect(stable.outcome.result.status).toBe("passed");
  expect(stable.records.filter((record) => record.kind === "screen.capture")).toHaveLength(3);
});

test("rejects matching images that do not match the rendering profile dimensions", async () => {
  const { outcome, records } = await runVisual({
    baseline: BLACK_PNG,
    capture: BLACK_PNG,
    profileSize: 10,
    regionSize: 1,
    stableFrames: 2,
    maxAttempts: 2,
  });
  expect(outcome.result.status).toBe("infrastructure-failed");
  expect(outcome.result.assertions[0]?.error?.code).toBe("visual-layout-mismatch");
  expect(records.filter((record) => record.kind === "screen.capture")).toHaveLength(1);
  expect(outcome.result.assertions[0]?.artifacts.map((artifact) => artifact.type)).toEqual([
    "visual-expected",
    "visual-actual",
  ]);
});

test("preserves cancellation and rejects baseline symlink escapes", async () => {
  const controller = new AbortController();
  const cancelled = await runVisual({
    baseline: BLACK_PNG,
    signal: controller.signal,
    abort: () => controller.abort(new Error("cancelled during capture")),
  });
  expect(cancelled.outcome.result).toMatchObject({ status: "cancelled", exitCode: 130 });

  const outside = join(await mkdtemp(join(tmpdir(), "couch-visual-outside-")), "outside.png");
  await Bun.write(outside, BLACK_PNG);
  const escaped = await runVisual({ baselineLink: outside });
  expect(escaped.outcome.result.status).toBe("infrastructure-failed");
  expect(escaped.outcome.result.assertions[0]?.error?.code).toBe("visual-baseline-outside-root");

  const traversal = await runVisual({ profileName: "../../outside" });
  expect(traversal.outcome.result.status).toBe("infrastructure-failed");
  expect(traversal.records).toHaveLength(0);
});

test.each([
  [{ configureTargetProfile: false }, "visual-profile-missing"],
  [{ assertionRegion: "missing" }, "visual-region-missing"],
  [{ assertionThreshold: 2 }, "visual-options-invalid"],
] as const)("records early visual configuration failures %#", async (options, code) => {
  const { outcome } = await runVisual({ baseline: BLACK_PNG, ...options });
  expect(outcome.result.status).toBe("infrastructure-failed");
  expect(outcome.result.assertions[0]?.error?.code).toBe(code);
});
