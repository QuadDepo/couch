import { chmod, mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { kill } from "node:process";
import { abortError, throwIfAborted } from "../utils/timing";
import { createOwnerRecord, type DeviceLockOwner, readOwner, releaseOwner } from "./ownerRecord";
import { recoverTemporaryOwners, removeStaleOwner } from "./staleRecovery";

export const DEFAULT_DEVICE_LOCK_DIRECTORY = join(homedir(), ".couch", "locks");

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

function processIsAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function createDeviceLock(lockDirectory: string): DeviceLock {
  return {
    async acquire(resourceId, options = {}) {
      throwIfAborted(options.signal);
      await mkdir(lockDirectory, { recursive: true, mode: 0o700 });
      await chmod(lockDirectory, 0o700);
      const resourcePath = join(lockDirectory, `${encodeURIComponent(resourceId)}.lock`);
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
      const ownerDirectory = join(resourcePath, "owner");
      await recoverTemporaryOwners(lockDirectory, resourceId, isProcessAlive);

      for (;;) {
        throwIfAborted(options.signal);
        const temporaryDirectory = join(
          lockDirectory,
          `.${encodeURIComponent(resourceId)}.lock.${owner.token}.tmp`,
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
        if (sameOwner(acquired, owner)) {
          if (options.signal?.aborted) {
            await releaseOwner(ownerDirectory, owner);
            throw abortError(options.signal);
          }
          let released = false;
          return {
            owner,
            async release() {
              if (released) return;
              released = true;
              await releaseOwner(ownerDirectory, owner);
            },
          };
        }
        if (!acquired) continue;
        if (acquired.pid === process.pid || isProcessAlive(acquired.pid)) {
          throw new Error(`Device ${resourceId} is already locked by PID ${acquired.pid}`);
        }
        await removeStaleOwner(ownerDirectory, acquired, options.signal);
      }
    },
  };
}

function sameOwner(left: DeviceLockOwner | undefined, right: DeviceLockOwner): boolean {
  return (
    left?.pid === right.pid &&
    left.runId === right.runId &&
    left.acquiredAt === right.acquiredAt &&
    left.token === right.token
  );
}

export type { DeviceLockOwner } from "./ownerRecord";
