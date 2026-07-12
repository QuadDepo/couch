import { chmod, rename, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { ODiffOptions } from "odiff-bin";

export const VISUAL_COMPARATOR = { name: "odiff-bin", version: "4.3.8" } as const;

export interface VisualRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualComparison {
  match: boolean;
  reason?: "pixel-diff" | "layout-diff";
  diffCount: number;
  diffRatio: number;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_START_OF_FRAME = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

export function imageDimensions(bytes: Uint8Array): ImageDimensions {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (PNG_SIGNATURE.every((byte, index) => bytes[index] === byte) && bytes.length >= 24) {
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (width > 0 && height > 0) return { width, height };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let offset = 2; offset + 8 < bytes.length; ) {
      if (view.getUint8(offset) !== 0xff) {
        offset += 1;
        continue;
      }
      while (offset < bytes.length && view.getUint8(offset) === 0xff) offset += 1;
      if (offset >= bytes.length) break;
      const marker = view.getUint8(offset++);
      if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
      if (offset + 1 >= bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (JPEG_START_OF_FRAME.has(marker) && length >= 7) {
        const height = view.getUint16(offset + 3);
        const width = view.getUint16(offset + 5);
        if (width > 0 && height > 0) return { width, height };
      }
      offset += length;
    }
  }
  throw new Error("Visual image dimensions could not be read");
}

function odiffRectangle(rectangle: VisualRectangle): string {
  return `${rectangle.x}:${rectangle.y}-${rectangle.x + rectangle.width}:${rectangle.y + rectangle.height}`;
}

export function ignoredOutsideRegion(
  profile: { width: number; height: number },
  region: VisualRectangle,
): VisualRectangle[] {
  const right = region.x + region.width;
  const bottom = region.y + region.height;
  return [
    { x: 0, y: 0, width: profile.width, height: region.y },
    { x: 0, y: bottom, width: profile.width, height: profile.height - bottom },
    { x: 0, y: region.y, width: region.x, height: region.height },
    { x: right, y: region.y, width: profile.width - right, height: region.height },
  ].filter((rectangle) => rectangle.width > 0 && rectangle.height > 0);
}

function intersection(a: VisualRectangle, b: VisualRectangle): VisualRectangle | undefined {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : undefined;
}

export function comparablePixelCount(
  region: VisualRectangle,
  masks: readonly VisualRectangle[],
): number {
  const clipped = masks.flatMap((mask) => {
    const overlap = intersection(region, mask);
    return overlap ? [overlap] : [];
  });
  const xCoordinates = [
    region.x,
    region.x + region.width,
    ...clipped.flatMap((mask) => [mask.x, mask.x + mask.width]),
  ].sort((a, b) => a - b);
  let maskedPixels = 0;
  for (let index = 0; index < xCoordinates.length - 1; index += 1) {
    const left = xCoordinates[index];
    const right = xCoordinates[index + 1];
    if (left === undefined || right === undefined || left === right) continue;
    const ranges = clipped
      .filter((mask) => mask.x < right && mask.x + mask.width > left)
      .map((mask) => [mask.y, mask.y + mask.height] as const)
      .sort((a, b) => a[0] - b[0]);
    let coveredHeight = 0;
    let rangeStart: number | undefined;
    let rangeEnd = 0;
    for (const [start, end] of ranges) {
      if (rangeStart === undefined) {
        rangeStart = start;
        rangeEnd = end;
      } else if (start > rangeEnd) {
        coveredHeight += rangeEnd - rangeStart;
        rangeStart = start;
        rangeEnd = end;
      } else {
        rangeEnd = Math.max(rangeEnd, end);
      }
    }
    if (rangeStart !== undefined) coveredHeight += rangeEnd - rangeStart;
    maskedPixels += (right - left) * coveredHeight;
  }
  return region.width * region.height - maskedPixels;
}

export function resolveODiffBinary(): string {
  const packageMain = createRequire(import.meta.url).resolve("odiff-bin");
  return join(dirname(packageMain), "bin", "odiff.exe");
}

function parsePixelDiff(stdout: string): { diffCount: number } {
  const diffCount = Number.parseInt(stdout.trim().split(";", 1)[0] ?? "", 10);
  if (!Number.isSafeInteger(diffCount) || diffCount < 0) {
    throw new Error(`ODiff returned invalid output: ${stdout.trim()}`);
  }
  return { diffCount };
}

async function runODiff(options: {
  expectedPath: string;
  actualPath: string;
  diffPath: string;
  threshold: NonNullable<ODiffOptions["threshold"]>;
  ignoreRegions: readonly VisualRectangle[];
  signal?: AbortSignal;
  binaryPath?: string;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  options.signal?.throwIfAborted();
  const command = [
    options.binaryPath ?? resolveODiffBinary(),
    options.expectedPath,
    options.actualPath,
    options.diffPath,
    "--parsable-stdout",
    "--fail-on-layout",
    `--threshold=${options.threshold}`,
    ...(options.ignoreRegions.length
      ? [`--ignore=${options.ignoreRegions.map(odiffRectangle).join(",")}`]
      : []),
  ];
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  let forceKill: ReturnType<typeof setTimeout> | undefined;
  let aborting = false;
  const abort = () => {
    if (aborting) return;
    aborting = true;
    child.kill("SIGTERM");
    forceKill = setTimeout(() => child.kill("SIGKILL"), 100);
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    options.signal?.throwIfAborted();
    return { exitCode, stdout, stderr };
  } finally {
    options.signal?.removeEventListener("abort", abort);
    if (forceKill) clearTimeout(forceKill);
  }
}

export async function compareVisualFiles(options: {
  expectedPath: string;
  actualPath: string;
  diffPath: string;
  threshold: NonNullable<ODiffOptions["threshold"]>;
  ignoreRegions: readonly VisualRectangle[];
  comparablePixels: number;
  signal?: AbortSignal;
  binaryPath?: string;
}): Promise<VisualComparison> {
  if (!Number.isSafeInteger(options.comparablePixels) || options.comparablePixels <= 0) {
    throw new Error("Visual comparison requires at least one comparable pixel");
  }
  const temporaryDiff = join(dirname(options.diffPath), `.${crypto.randomUUID()}.diff.png`);
  try {
    const result = await runODiff({ ...options, diffPath: temporaryDiff });
    if (result.exitCode === 0) {
      await unlink(temporaryDiff).catch(() => undefined);
      return { match: true, diffCount: 0, diffRatio: 0 };
    }
    if (result.exitCode === 21) {
      await unlink(temporaryDiff).catch(() => undefined);
      return { match: false, reason: "layout-diff", diffCount: 0, diffRatio: 0 };
    }
    if (result.exitCode !== 22) {
      throw new Error(result.stderr.trim() || `ODiff exited with code ${result.exitCode}`);
    }
    const { diffCount } = parsePixelDiff(result.stdout);
    if (diffCount > options.comparablePixels) {
      throw new Error("ODiff reported differences outside the comparable region");
    }
    await chmod(temporaryDiff, 0o600).catch(() => undefined);
    await rename(temporaryDiff, options.diffPath);
    return {
      match: false,
      reason: "pixel-diff",
      diffCount,
      diffRatio: diffCount / options.comparablePixels,
    };
  } catch (error) {
    await unlink(temporaryDiff).catch(() => undefined);
    throw error;
  }
}
