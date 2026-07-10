import { open, readdir, readFile, rename, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";

export interface DeviceLockOwner {
  pid: number;
  runId: string;
  acquiredAt: string;
  resourceId: string;
  token: string;
}

export function parseOwner(
  contents: string,
  resourceId: string,
  token: string,
): DeviceLockOwner | undefined {
  try {
    const value = JSON.parse(contents) as Partial<DeviceLockOwner>;
    if (
      typeof value.pid !== "number" ||
      !Number.isInteger(value.pid) ||
      typeof value.runId !== "string" ||
      typeof value.acquiredAt !== "string" ||
      value.resourceId !== resourceId ||
      value.token !== token
    ) {
      return undefined;
    }
    return value as DeviceLockOwner;
  } catch {
    return undefined;
  }
}

export async function createOwnerRecord(
  ownerDirectory: string,
  owner: DeviceLockOwner,
): Promise<void> {
  const ownerPath = join(ownerDirectory, owner.token);
  const temporaryPath = join(ownerDirectory, `.${owner.token}.tmp`);
  try {
    const file = await open(temporaryPath, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(owner), "utf8");
    } finally {
      await file.close();
    }
    await rename(temporaryPath, ownerPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    await unlink(ownerPath).catch(() => undefined);
    throw error;
  }
}

export async function releaseOwner(ownerDirectory: string, owner: DeviceLockOwner): Promise<void> {
  const ownerPath = join(ownerDirectory, owner.token);
  let current: DeviceLockOwner | undefined;
  try {
    current = parseOwner(await readFile(ownerPath, "utf8"), owner.resourceId, owner.token);
  } catch {
    return;
  }
  if (
    !current ||
    current.pid !== owner.pid ||
    current.runId !== owner.runId ||
    current.acquiredAt !== owner.acquiredAt
  ) {
    return;
  }
  try {
    await unlink(ownerPath);
  } catch {
    return;
  }
  await rmdir(ownerDirectory).catch(() => undefined);
}

export async function readOwner(
  ownerDirectory: string,
  resourceId: string,
): Promise<DeviceLockOwner | undefined> {
  let entries: string[];
  try {
    entries = await readdir(ownerDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const [token] = entries;
  if (entries.length !== 1 || !token || token.startsWith(".")) {
    throw new Error(`Device lock exists for ${resourceId}`);
  }
  try {
    return parseOwner(await readFile(join(ownerDirectory, token), "utf8"), resourceId, token);
  } catch {
    throw new Error(`Device lock exists for ${resourceId}`);
  }
}
