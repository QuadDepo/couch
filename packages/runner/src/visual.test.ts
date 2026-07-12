import { expect, test } from "bun:test";
import { access, chmod, cp, mkdtemp, readdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { comparablePixelCount, compareVisualFiles, resolveODiffBinary } from "./visual";

const BLACK = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const WHITE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1xQAAAAASUVORK5CYII=",
  "base64",
);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "couch-visual-"));
  const expectedPath = join(root, "expected.png");
  const actualPath = join(root, "actual.png");
  const diffPath = join(root, "diff.png");
  await Promise.all([Bun.write(expectedPath, BLACK), Bun.write(actualPath, WHITE)]);
  return { root, expectedPath, actualPath, diffPath };
}

test("compares pixels and atomically publishes a diff", async () => {
  const paths = await fixture();
  const result = await compareVisualFiles({
    ...paths,
    threshold: 0,
    ignoreRegions: [],
    comparablePixels: 1,
  });

  expect(result).toEqual({
    match: false,
    reason: "pixel-diff",
    diffCount: 1,
    diffRatio: 1,
  });
  expect(await Bun.file(paths.diffPath).exists()).toBe(true);
  expect((await readdir(paths.root)).some((name) => name.startsWith("."))).toBe(false);
});

test("supports ignore regions and layout classification", async () => {
  const paths = await fixture();
  expect(
    await compareVisualFiles({
      ...paths,
      threshold: 0,
      ignoreRegions: [{ x: 0, y: 0, width: 1, height: 1 }],
      comparablePixels: 1,
    }),
  ).toEqual({ match: true, diffCount: 0, diffRatio: 0 });

  const large = join(paths.root, "large.png");
  await Bun.write(large, Bun.file(join(import.meta.dir, "../../../test.png")));
  expect(
    await compareVisualFiles({
      ...paths,
      actualPath: large,
      threshold: 0,
      ignoreRegions: [],
      comparablePixels: 1,
    }),
  ).toEqual({ match: false, reason: "layout-diff", diffCount: 0, diffRatio: 0 });
});

test("counts comparable region pixels once across overlapping masks", () => {
  expect(
    comparablePixelCount({ x: 0, y: 0, width: 10, height: 10 }, [
      { x: 0, y: 0, width: 6, height: 10 },
      { x: 5, y: 0, width: 5, height: 5 },
    ]),
  ).toBe(20);
});

test("terminates an in-flight native comparison when aborted", async () => {
  const paths = await fixture();
  const binaryPath = join(paths.root, "pending-odiff");
  const pidPath = join(paths.root, "pending.pid");
  await Bun.write(
    binaryPath,
    `#!/bin/sh\necho $$ > ${JSON.stringify(pidPath)}\ntrap '' TERM\nwhile :; do :; done\n`,
  );
  await chmod(binaryPath, 0o700);
  const controller = new AbortController();
  const comparison = compareVisualFiles({
    ...paths,
    threshold: 0,
    ignoreRegions: [],
    comparablePixels: 1,
    signal: controller.signal,
    binaryPath,
  });
  while (!(await Bun.file(pidPath).exists())) await Bun.sleep(5);
  const pid = Number(await Bun.file(pidPath).text());
  const abortedAt = performance.now();
  controller.abort(new Error("cancel comparison"));

  await expect(comparison).rejects.toThrow("cancel comparison");
  expect(performance.now() - abortedAt).toBeLessThan(1_000);
  expect(() => process.kill(pid, 0)).toThrow();
  expect((await readdir(paths.root)).some((file) => file.endsWith(".diff.png"))).toBe(false);
});

test("keeps built CLI paths relocatable and resolves ODiff after relocation", async () => {
  const root = await mkdtemp(join(tmpdir(), "couch-visual-build-"));
  const repositoryRoot = resolve(import.meta.dir, "../../..");
  const cliBuild = Bun.spawn(
    [
      process.execPath,
      "build",
      "apps/cli/src/index.ts",
      "--outdir",
      join(root, "cli"),
      "--target",
      "bun",
    ],
    { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" },
  );
  expect(await cliBuild.exited).toBe(0);
  const cliOutput = await Bun.file(join(root, "cli/index.js")).text();
  expect(cliOutput).not.toContain(repositoryRoot);

  const probePath = join(root, "probe.ts");
  await Bun.write(
    probePath,
    `import { resolveODiffBinary } from ${JSON.stringify(join(import.meta.dir, "visual.ts"))}; const binary = resolveODiffBinary(); const result = Bun.spawnSync([binary, "--version"]); if (result.exitCode !== 0) throw new Error(result.stderr.toString()); console.log(binary);`,
  );
  const relocated = join(root, "relocated");
  const probeBuild = await Bun.build({
    entrypoints: [probePath],
    outdir: relocated,
    target: "bun",
  });
  expect(probeBuild.success).toBe(true);
  await cp(join(dirname(resolveODiffBinary()), ".."), join(relocated, "node_modules/odiff-bin"), {
    recursive: true,
  });
  const probe = Bun.spawn([process.execPath, join(relocated, "probe.js")], {
    cwd: relocated,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await probe.exited).toBe(0);
  const binary = (await new Response(probe.stdout).text()).trim();
  await access(binary);
  expect(await realpath(binary)).toStartWith(await realpath(relocated));
});
