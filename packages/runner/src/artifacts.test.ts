import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertRealContained,
  publishBytes,
  publishText,
  resolveContained,
  safeArtifactSegment,
} from "./artifacts";

test("contains paths, publishes atomically, and leaves no temporary files", async () => {
  const root = await mkdtemp(join(tmpdir(), "couch-artifacts-"));
  expect(() => resolveContained(root, "..")).toThrow("escapes");
  expect(safeArtifactSegment("..", "safe")).toBe("safe");
  const binaryPath = resolveContained(root, "actual.png");
  const diagnosticsPath = resolveContained(root, "diagnostics.log");
  await publishBytes(binaryPath, new Uint8Array([137, 80, 78, 71]));
  await publishText(diagnosticsPath, "diagnostic\n");
  expect(new Uint8Array(await Bun.file(binaryPath).arrayBuffer())).toEqual(
    new Uint8Array([137, 80, 78, 71]),
  );
  expect((await stat(binaryPath)).mode & 0o777).toBe(0o600);
  expect((await stat(diagnosticsPath)).mode & 0o777).toBe(0o600);
  expect((await readdir(root)).some((name) => name.endsWith(".tmp"))).toBe(false);
});

test("rejects symlink components that escape the physical artifact root", async () => {
  const root = await mkdtemp(join(tmpdir(), "couch-artifacts-root-"));
  const outside = await mkdtemp(join(tmpdir(), "couch-artifacts-outside-"));
  const link = join(root, "link");
  await symlink(outside, link);
  await expect(assertRealContained(root, link)).rejects.toThrow("escapes");
});

test("cleans its temporary file when atomic publication fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "couch-artifacts-failure-"));
  const finalPath = join(root, "occupied");
  await mkdir(finalPath);
  await expect(publishBytes(finalPath, new Uint8Array([1]))).rejects.toBeDefined();
  expect((await readdir(root)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
});
