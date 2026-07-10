import { describe, expect, test } from "bun:test";
import { runCli } from "./cli";
import { output } from "./testSupport/fakes";

describe("CLI dispatch", () => {
  test("returns stable help", async () => {
    const result = output();
    expect(await runCli(["--help"], { stdout: result.writeOut, stderr: result.writeErr })).toBe(0);
    expect(result.stdout[0]).toContain("couch device list");
    expect(result.stdout[0]).toContain("couch remote press");
  });

  test("returns usage errors without creating an inventory", async () => {
    const result = output();
    let created = false;
    const exit = await runCli(["remote", "press", "lab", "NOPE"], {
      createInventory: () => {
        created = true;
        throw new Error("unreachable");
      },
      stdout: result.writeOut,
      stderr: result.writeErr,
    });
    expect(exit).toBe(64);
    expect(created).toBe(false);
    expect(result.stdout).toEqual([]);
    expect(result.stderr[0]).toContain("unknown remote key");
  });
});
