import { chmod, mkdir, open, readdir, readFile, rename, rmdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { kill } from "node:process";

export const DEFAULT_DEVICE_LOCK_DIRECTORY = join(homedir(), ".couch", "locks");

export interface DeviceLockOwner {
  pid: number;
  runId: string;
  acquiredAt: string;
  resourceId: string;
  token: string;
}

export interface DeviceLockHandle {
  readonly owner: DeviceLockOwner;
  release(): Promise<void>;
}

export interface DeviceLockOptions {
  runId?: string;
  signal?: AbortSignal;
  isProcessAlive?: (pid: number) => boolean;
}

export interface DeviceLock {
  acquire(resourceId: string, options?: DeviceLockOptions): Promise<DeviceLockHandle>;
}

const OWNER_DIRECTORY = "owner";

function lockDirectoryName(resourceId: string): string {
  return `${encodeURIComponent(resourceId)}.lock`;
}

function temporaryLockDirectoryName(resourceId: string, token: string): string {
  return `.${lockDirectoryName(resourceId)}.${token}.tmp`;
}

function temporaryOwnerToken(entry: string): string | undefined {
  if (!entry.startsWith(".") || !entry.endsWith(".tmp")) return undefined;
  const token = entry.slice(1, -".tmp".length);
  return token || undefined;
}

function processIsAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function cancellationError(signal?: AbortSignal): Error | undefined {
  if (!signal?.aborted) return undefined;
  const reason = signal.reason;
  return reason instanceof Error
    ? reason
    : new DOMException("The operation was aborted", "AbortError");
}

function lockExistsError(resourceId: string): Error {
  return new Error(`Device lock exists for ${resourceId}`);
}

function alreadyLockedError(resourceId: string, pid?: number): Error {
  return pid === undefined
    ? new Error(`Device ${resourceId} is already locked`)
    : new Error(`Device ${resourceId} is already locked by PID ${pid}`);
}

function parseOwner(
  contents: string,
  resourceId: string,
  token: string,
): DeviceLockOwner | undefined {
  try {
    const value = JSON.parse(contents) as Partial<DeviceLockOwner>;
    if (
      !value ||
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

async function createOwnerRecord(ownerDirectory: string, owner: DeviceLockOwner): Promise<void> {
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

async function removeOwnerRecord(ownerDirectory: string, owner: DeviceLockOwner): Promise<boolean> {
  const ownerPath = join(ownerDirectory, owner.token);
  let current: DeviceLockOwner | undefined;
  try {
    current = parseOwner(await readFile(ownerPath, "utf8"), owner.resourceId, owner.token);
  } catch {
    return false;
  }
  if (
    !current ||
    current.pid !== owner.pid ||
    current.runId !== owner.runId ||
    current.acquiredAt !== owner.acquiredAt
  ) {
    return false;
  }
  try {
    await unlink(ownerPath);
    return true;
  } catch {
    return false;
  }
}

async function releaseOwner(ownerDirectory: string, owner: DeviceLockOwner): Promise<void> {
  if (!(await removeOwnerRecord(ownerDirectory, owner))) return;
  await rmdir(ownerDirectory).catch(() => undefined);
}

async function recoverTemporaryOwners(
  lockDirectory: string,
  resourceId: string,
  isProcessAlive: (pid: number) => boolean,
): Promise<void> {
  const prefix = `.${lockDirectoryName(resourceId)}.`;
  let entries: string[];
  try {
    entries = await readdir(lockDirectory);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.startsWith(prefix) || !entry.endsWith(".tmp")) continue;
    const ownerDirectory = join(lockDirectory, entry);
    let ownerFiles: string[];
    try {
      ownerFiles = await readdir(ownerDirectory);
    } catch {
      continue;
    }
    const [token] = ownerFiles;
    if (ownerFiles.length !== 1 || !token || token.startsWith(".")) continue;

    let owner: DeviceLockOwner | undefined;
    try {
      owner = parseOwner(await readFile(join(ownerDirectory, token), "utf8"), resourceId, token);
    } catch {
      continue;
    }
    if (!owner || owner.pid === process.pid || isProcessAlive(owner.pid)) continue;

    await unlink(join(ownerDirectory, token)).catch(() => undefined);
    await rmdir(ownerDirectory).catch(() => undefined);
  }
}

async function readOwner(
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
    throw lockExistsError(resourceId);
  }
  try {
    return parseOwner(await readFile(join(ownerDirectory, token), "utf8"), resourceId, token);
  } catch {
    throw lockExistsError(resourceId);
  }
}

async function recoverLegacyOwner(
  resourcePath: string,
  resourceId: string,
  isProcessAlive: (pid: number) => boolean,
  signal?: AbortSignal,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(resourcePath);
  } catch {
    throw lockExistsError(resourceId);
  }
  const legacyEntries = entries.filter((entry) => entry !== OWNER_DIRECTORY);
  if (legacyEntries.length === 0) return;
  const [entry] = legacyEntries;
  if (legacyEntries.length !== 1 || !entry) throw lockExistsError(resourceId);

  const token = temporaryOwnerToken(entry) ?? entry;
  if (entry.startsWith(".") && !temporaryOwnerToken(entry)) {
    throw lockExistsError(resourceId);
  }
  let owner: DeviceLockOwner | undefined;
  try {
    owner = parseOwner(await readFile(join(resourcePath, entry), "utf8"), resourceId, token);
  } catch {
    throw lockExistsError(resourceId);
  }
  if (!owner) throw lockExistsError(resourceId);
  if (owner.pid === process.pid || isProcessAlive(owner.pid)) {
    throw alreadyLockedError(resourceId, owner.pid);
  }

  const cancelled = cancellationError(signal);
  if (cancelled) throw cancelled;
  await unlink(join(resourcePath, entry)).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
  const afterCleanup = cancellationError(signal);
  if (afterCleanup) throw afterCleanup;
}

/** Creates an owner-only, atomic, PID-aware lock for one physical device. */
export function createDeviceLock(lockDirectory: string): DeviceLock {
  return {
    async acquire(resourceId, options = {}) {
      const cancelled = cancellationError(options.signal);
      if (cancelled) throw cancelled;
      await mkdir(lockDirectory, { recursive: true, mode: 0o700 });
      await chmod(lockDirectory, 0o700);

      const resourcePath = join(lockDirectory, lockDirectoryName(resourceId));
      await mkdir(resourcePath, { recursive: true, mode: 0o700 });
      await chmod(resourcePath, 0o700);

      const owner: DeviceLockOwner = {
        pid: process.pid,
        runId: options.runId ?? crypto.randomUUID(),
        acquiredAt: new Date().toISOString(),
        resourceId,
        token: crypto.randomUUID(),
      };
      const isProcessAlive = options.isProcessAlive ?? processIsAlive;
      const ownerDirectory = join(resourcePath, OWNER_DIRECTORY);

      await recoverTemporaryOwners(lockDirectory, resourceId, isProcessAlive);
      await recoverLegacyOwner(resourcePath, resourceId, isProcessAlive, options.signal);

      for (;;) {
        const beforeAttempt = cancellationError(options.signal);
        if (beforeAttempt) throw beforeAttempt;

        const temporaryDirectory = join(
          lockDirectory,
          temporaryLockDirectoryName(resourceId, owner.token),
        );
        try {
          await mkdir(temporaryDirectory, { mode: 0o700 });
          await chmod(temporaryDirectory, 0o700);
          await createOwnerRecord(temporaryDirectory, owner);
          await rename(temporaryDirectory, ownerDirectory);
        } catch (error) {
          await releaseOwner(temporaryDirectory, owner);
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== "EEXIST" && code !== "ENOTEMPTY") throw error;
        }

        const acquired = await readOwner(ownerDirectory, resourceId);
        if (
          acquired &&
          acquired.pid === owner.pid &&
          acquired.runId === owner.runId &&
          acquired.acquiredAt === owner.acquiredAt &&
          acquired.token === owner.token
        ) {
          const afterCreate = cancellationError(options.signal);
          if (afterCreate) {
            await releaseOwner(ownerDirectory, owner);
            throw afterCreate;
          }
          let released = false;
          return {
            owner,
            async release() {
              if (released) return;
              released = true;
              await releaseOwner(ownerDirectory, owner);
            },
          } satisfies DeviceLockHandle;
        }

        if (!acquired) {
          await rmdir(ownerDirectory).catch(() => undefined);
          continue;
        }
        if (acquired.pid === process.pid || isProcessAlive(acquired.pid)) {
          throw alreadyLockedError(resourceId, acquired.pid);
        }

        const stale = cancellationError(options.signal);
        if (stale) throw stale;
        await unlink(join(ownerDirectory, acquired.token)).catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        });
        await rmdir(ownerDirectory).catch((error) => {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== "ENOENT" && code !== "ENOTEMPTY") throw error;
        });
        const afterCleanup = cancellationError(options.signal);
        if (afterCleanup) throw afterCleanup;
      }
    },
  };
}

export function canonicalLockResourceId(device: {
  id: string;
  platform: string;
  ip?: string;
}): string {
  if (device.platform === "android-tv") return `adb:${device.ip ?? device.id}:5555`;
  return `device:${device.id}`;
}
