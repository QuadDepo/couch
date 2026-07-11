import { chmod, mkdir, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

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
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${crypto.randomUUID()}.tmp`);
  try {
    await writeFile(temporary, value, { mode: 0o600 });
    await rename(temporary, path);
    await chmod(path, 0o600).catch(() => undefined);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export function safeArtifactSegment(value: string, fallback: string): string {
  const segment = value
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-|-$/g, "");
  return !segment || segment === "." || segment === ".." ? fallback : segment;
}

export function resolveContained(root: string, ...segments: readonly string[]): string {
  const absoluteRoot = resolve(root);
  const candidate = resolve(absoluteRoot, ...segments);
  const fromRoot = relative(absoluteRoot, candidate);
  if (
    fromRoot === ".." ||
    fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new Error(`Artifact path escapes ${absoluteRoot}`);
  }
  return candidate;
}

export async function assertRealContained(root: string, path: string): Promise<void> {
  const [physicalRoot, physicalPath] = await Promise.all([realpath(root), realpath(path)]);
  const fromRoot = relative(physicalRoot, physicalPath);
  if (
    fromRoot === ".." ||
    fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new Error(`Artifact path escapes ${physicalRoot}`);
  }
}
