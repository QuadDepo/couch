import { chmod, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Write `bytes` to `path` atomically: stage in a sibling temp file with owner-only
 * permissions, then rename over the target. The temp file is removed if any step
 * fails so a crash never leaves a partial artifact behind.
 */
export async function atomicWrite(
  path: string,
  bytes: Uint8Array,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${crypto.randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { mode: 0o600 });
    options.signal?.throwIfAborted();
    await rename(temporary, path);
    await chmod(path, 0o600).catch(() => undefined);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}
