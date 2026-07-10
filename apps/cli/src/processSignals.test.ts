import { describe, expect, test } from "bun:test";
import { installSignalControl } from "./processSignals";
import { signalTarget } from "./testSupport/fakes";

describe("signal control", () => {
  test("installs, aborts, and removes both handlers", async () => {
    const target = signalTarget();
    const control = installSignalControl(target);
    let closeCount = 0;
    control.setCleanup(async () => {
      closeCount += 1;
    });
    target.emit("SIGINT");
    target.emit("SIGTERM");
    expect(control.signal.aborted).toBe(true);
    expect(control.exitCode).toBe(130);
    expect(control.message).toBe("Interrupted");
    expect(await control.cleanup()).toBeUndefined();
    expect(closeCount).toBe(1);
    control.dispose();
    expect(target.removed).toEqual(["SIGINT", "SIGTERM"]);
  });
});
