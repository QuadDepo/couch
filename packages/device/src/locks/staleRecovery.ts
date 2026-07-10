import { readdir, readFile, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { DeviceLockOwner } from "./ownerRecord";
import { parseOwner } from "./ownerRecord";

export async function recoverTemporaryOwners(
  lockDirectory: string,
  resourceId: string,
  isProcessAlive: (pid: number) => boolean,
): Promise<void> {
  const prefix = `.${encodeURIComponent(resourceId)}.lock.`;
  let entries: string[];
  try {
    entries = await readdir(lockDirectory);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.startsWith(prefix) || !entry.endsWith(".tmp")) continue;
    const directory = join(lockDirectory, entry);
    let ownerFiles: string[];
    try {
      ownerFiles = await readdir(directory);
    } catch {
      continue;
    }
    const [token] = ownerFiles;
    if (ownerFiles.length !== 1 || !token || token.startsWith(".")) continue;
    let owner: DeviceLockOwner | undefined;
    try {
      owner = parseOwner(await readFile(join(directory, token), "utf8"), resourceId, token);
    } catch {
      continue;
    }
    if (!owner || owner.pid === process.pid || isProcessAlive(owner.pid)) continue;
    await unlink(join(directory, token)).catch(() => undefined);
    await rmdir(directory).catch(() => undefined);
  }
}

export async function removeStaleOwner(
  ownerDirectory: string,
  owner: DeviceLockOwner,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw abortReason(signal);
  await unlink(join(ownerDirectory, owner.token)).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
  await rmdir(ownerDirectory).catch((error) => {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTEMPTY") throw error;
  });
  if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}
