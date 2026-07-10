import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeviceLock } from "./deviceLock";

describe("device lock", () => {
  test("acquires atomically, refuses a live owner, and releases idempotently", async () => {
    const directory = await mkdtemp(join(tmpdir(), "couch-lock-"));
    const lock = createDeviceLock(directory);
    const first = await lock.acquire("adb:tv:5555", { runId: "one" });
    const resourcePath = join(directory, `${encodeURIComponent("adb:tv:5555")}.lock`);
    const [ownerDirectory] = await readdir(resourcePath);
    const [token] = await readdir(join(resourcePath, ownerDirectory));
    expect((await stat(resourcePath)).mode & 0o777).toBe(0o700);
    expect((await stat(join(resourcePath, ownerDirectory))).mode & 0o777).toBe(0o700);
    expect((await stat(join(resourcePath, ownerDirectory, token))).mode & 0o777).toBe(0o600);
    await expect(lock.acquire("adb:tv:5555", { isProcessAlive: () => true })).rejects.toThrow(
      /already locked/,
    );
    await first.release();
    await first.release();
    await expect(readdir(resourcePath)).resolves.toEqual([]);
    const second = await lock.acquire("adb:tv:5555", { runId: "two" });
    await second.release();
    await rm(directory, { recursive: true, force: true });
  });

  test("allows exactly one owner under high-contention first acquisition", async () => {
    const directory = await mkdtemp(join(tmpdir(), "couch-lock-"));
    const lock = createDeviceLock(directory);
    for (let round = 0; round < 20; round += 1) {
      const resourceId = `device:tv:${round}`;
      const attempts = await Promise.allSettled(
        Array.from({ length: 32 }, () => lock.acquire(resourceId, { runId: "contended" })),
      );
      const acquired = attempts.filter(
        (attempt): attempt is PromiseFulfilledResult<Awaited<ReturnType<typeof lock.acquire>>> =>
          attempt.status === "fulfilled",
      );
      const rejected = attempts.filter((attempt) => attempt.status === "rejected");

      expect(acquired).toHaveLength(1);
      expect(rejected).toHaveLength(31);
      for (const attempt of rejected) {
        expect((attempt as PromiseRejectedResult).reason.message).toMatch(/already locked/);
      }
      await acquired[0].value.release();
    }

    await rm(directory, { recursive: true, force: true });
  });

  test("recovers a temporary owner directory whose process was interrupted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "couch-lock-"));
    const resourceId = "device:tv";
    const token = "interrupted-owner";
    const temporaryDirectory = join(
      directory,
      `.${encodeURIComponent(resourceId)}.lock.${token}.tmp`,
    );
    await mkdir(temporaryDirectory, { mode: 0o700 });
    await writeFile(
      join(temporaryDirectory, token),
      JSON.stringify({
        pid: 987654321,
        runId: "interrupted",
        acquiredAt: "2026-07-10T00:00:00.000Z",
        resourceId,
        token,
      }),
      { mode: 0o600 },
    );

    const lock = createDeviceLock(directory);
    const handle = await lock.acquire(resourceId, { isProcessAlive: () => false });

    await expect(readdir(temporaryDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    await handle.release();
    await rm(directory, { recursive: true, force: true });
  });

  test("recovers an interrupted old-format temporary owner record", async () => {
    const directory = await mkdtemp(join(tmpdir(), "couch-lock-"));
    const resourceId = "device:tv";
    const token = "interrupted-owner";
    const resourcePath = join(directory, `${encodeURIComponent(resourceId)}.lock`);
    await mkdir(resourcePath, { mode: 0o700 });
    await writeFile(
      join(resourcePath, `.${token}.tmp`),
      JSON.stringify({
        pid: 987654321,
        runId: "interrupted",
        acquiredAt: "2026-07-10T00:00:00.000Z",
        resourceId,
        token,
      }),
      { mode: 0o600 },
    );

    const handle = await createDeviceLock(directory).acquire(resourceId, {
      isProcessAlive: () => false,
    });

    await expect(readdir(resourcePath)).resolves.toEqual(["owner"]);
    await expect(readdir(join(resourcePath, "owner"))).resolves.toEqual([handle.owner.token]);
    await handle.release();
    await rm(directory, { recursive: true, force: true });
  });

  test("recovers a valid lock only when its owner PID is gone", async () => {
    const directory = await mkdtemp(join(tmpdir(), "couch-lock-"));
    const lock = createDeviceLock(directory);
    const first = await lock.acquire("device:tv", { runId: "old" });
    const resourcePath = join(directory, `${encodeURIComponent("device:tv")}.lock`);
    const [ownerDirectory] = await readdir(resourcePath);
    const [token] = await readdir(join(resourcePath, ownerDirectory));
    const path = join(resourcePath, ownerDirectory, token);
    const stale = JSON.parse(await readFile(path, "utf8")) as { pid: number };
    stale.pid = 987654321;
    await writeFile(path, JSON.stringify(stale));
    const recovered = await lock.acquire("device:tv", {
      isProcessAlive: () => false,
      runId: "new",
    });
    await recovered.release();
    await first.release();
    await rm(directory, { recursive: true, force: true });
  });

  test("concurrent stale recovery leaves exactly one replacement owner", async () => {
    const directory = await mkdtemp(join(tmpdir(), "couch-lock-"));
    const lock = createDeviceLock(directory);
    const staleHandle = await lock.acquire("device:tv", { runId: "old" });
    const resourcePath = join(directory, `${encodeURIComponent("device:tv")}.lock`);
    const [ownerDirectory] = await readdir(resourcePath);
    const [staleToken] = await readdir(join(resourcePath, ownerDirectory));
    const stalePath = join(resourcePath, ownerDirectory, staleToken);
    const stale = JSON.parse(await readFile(stalePath, "utf8")) as { pid: number };
    stale.pid = 987654321;
    await writeFile(stalePath, JSON.stringify(stale));

    const isProcessAlive = (pid: number) => pid === process.pid;
    const results = await Promise.allSettled([
      lock.acquire("device:tv", { isProcessAlive, runId: "replacement-one" }),
      lock.acquire("device:tv", { isProcessAlive, runId: "replacement-two" }),
    ]);
    const acquired = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof lock.acquire>>> =>
        result.status === "fulfilled",
    );
    const rejected = results.filter((result) => result.status === "rejected");

    expect(acquired).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/already locked/);

    await staleHandle.release();
    await expect(lock.acquire("device:tv", { isProcessAlive })).rejects.toThrow(/already locked/);
    await acquired[0].value.release();
    await rm(directory, { recursive: true, force: true });
  });

  test("honors an already-aborted signal without creating a lock", async () => {
    const directory = await mkdtemp(join(tmpdir(), "couch-lock-"));
    const lock = createDeviceLock(directory);
    const controller = new AbortController();
    controller.abort();

    await expect(lock.acquire("device:tv", { signal: controller.signal })).rejects.toThrow(
      /aborted/,
    );
    const handle = await lock.acquire("device:tv");
    await handle.release();
    await rm(directory, { recursive: true, force: true });
  });
});
