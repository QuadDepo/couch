import { chmod, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { atomicWrite } from "@couch/device";

export async function prepareArtifactDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700).catch(() => undefined);
}

export async function publishJson(path: string, value: unknown): Promise<void> {
  const json = `${JSON.stringify(value, null, 2)}\n`;
  await publishText(path, json);
}

export async function publishText(path: string, value: string): Promise<void> {
  await publishBytes(path, new TextEncoder().encode(value));
}

export async function publishBytes(path: string, value: Uint8Array): Promise<void> {
  await atomicWrite(path, value);
}

export function safeArtifactSegment(value: string, fallback: string): string {
  const segment = value
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-|-$/g, "");
  return !segment || segment === "." || segment === ".." ? fallback : segment;
}

// A relative path escapes its root when it steps above it (`..`) or resolves absolutely.
function assertWithinRoot(root: string, path: string): void {
  const fromRoot = relative(root, path);
  if (
    fromRoot === ".." ||
    fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new Error(`Artifact path escapes ${root}`);
  }
}

export function resolveContained(root: string, ...segments: readonly string[]): string {
  const absoluteRoot = resolve(root);
  const candidate = resolve(absoluteRoot, ...segments);
  assertWithinRoot(absoluteRoot, candidate);
  return candidate;
}

export async function assertRealContained(root: string, path: string): Promise<void> {
  const [physicalRoot, physicalPath] = await Promise.all([realpath(root), realpath(path)]);
  assertWithinRoot(physicalRoot, physicalPath);
}
