import { describe, expect, spyOn, test } from "bun:test";
import type { DeviceOperation, OperationRecord } from "@couch/device";
import { buildTestContext } from "./testContext";

function context(signal?: AbortSignal) {
  const assertions: Parameters<typeof buildTestContext>[0]["assertions"] = [];
  const operations: DeviceOperation[] = [];
  const execute = async (operation: DeviceOperation): Promise<OperationRecord> => {
    operations.push(operation);
    return {
      id: crypto.randomUUID(),
      ordinal: operations.length,
      kind: operation.kind,
      adapterId: "test",
      status: "succeeded",
      confirmation: "process-exit",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      input: operation,
      artifacts: [],
    };
  };
  return {
    assertions,
    operations,
    value: buildTestContext({
      execute,
      target: { deviceId: "test", app: { id: "test" } },
      directory: "/tmp",
      operations: [],
      assertions,
      artifacts: [],
      signal,
    }),
  };
}

describe("polling assertions", () => {
  test("records one assertion for immediate and eventual success", async () => {
    const immediate = context();
    await immediate.value.expect.poll(() => "ready").equal("ready");
    expect(immediate.assertions).toEqual([
      expect.objectContaining({ matcher: "poll.equal", status: "passed" }),
    ]);

    const eventual = context();
    let attempts = 0;
    await eventual.value.expect
      .poll(() => (++attempts === 2 ? "ready" : "waiting"), { intervalMs: 0 })
      .equal("ready");
    expect(attempts).toBe(2);
    expect(eventual.assertions).toHaveLength(1);
  });

  test("records exhausted attempts as one assertion failure", async () => {
    const fixture = context();
    await expect(
      fixture.value.expect.poll(() => "waiting", { attempts: 2, intervalMs: 0 }).equal("ready"),
    ).rejects.toThrow("Expected ready, received waiting");
    expect(fixture.assertions).toEqual([
      expect.objectContaining({ matcher: "poll.equal", status: "failed" }),
    ]);
  });

  test("cancels during the polling interval", async () => {
    const controller = new AbortController();
    const fixture = context(controller.signal);
    let enteredInterval = () => undefined;
    const intervalStarted = new Promise<void>((resolve) => {
      enteredInterval = resolve;
    });
    const polling = fixture.value.expect
      .poll(
        () => {
          enteredInterval();
          return "waiting";
        },
        { attempts: 2, intervalMs: 10_000 },
      )
      .equal("ready");
    await intervalStarted;
    await Promise.resolve();
    controller.abort(new Error("Interrupted"));
    await expect(polling).rejects.toThrow("Interrupted");
    expect(fixture.assertions).toHaveLength(0);
  });
});

test("press sends serial operations and waits only between sends", async () => {
  const fixture = context();
  const delays: number[] = [];
  const callbacks: (() => void)[] = [];
  const timer = spyOn(globalThis, "setTimeout").mockImplementation((callback, delay) => {
    delays.push(Number(delay));
    callbacks.push(callback as () => void);
    return 0 as unknown as ReturnType<typeof setTimeout>;
  });
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  try {
    const pressing = fixture.value.tv.press("LEFT", { times: 3, intervalMs: 10 });
    await flush();
    expect(fixture.operations).toHaveLength(1);
    expect(callbacks).toHaveLength(1);

    callbacks.shift()?.();
    await flush();
    expect(fixture.operations).toHaveLength(2);
    expect(callbacks).toHaveLength(1);

    callbacks.shift()?.();
    await pressing;
    expect(fixture.operations.map((operation) => operation.kind)).toEqual([
      "control.press",
      "control.press",
      "control.press",
    ]);
    expect(callbacks).toHaveLength(0);
    expect(delays).toEqual([10, 10]);
  } finally {
    timer.mockRestore();
  }
});
