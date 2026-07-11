import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { sanitizeWebosRequestError } from "../devices/lg-webos/authorization";
import type { DriverReceipt } from "../drivers/types";
import { DeviceInventoryError } from "../errors";
import { fakeDriver, openSession } from "./testSupport";

const directories: string[] = [];

async function open(driver = fakeDriver()) {
  const harness = await openSession(driver);
  directories.push(harness.directory);
  return harness;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("DeviceSession execution", () => {
  test("executes operations in FIFO order with awaited receipts", async () => {
    const { driver, session } = await open(
      fakeDriver([{ confirmation: "process-exit" }, { confirmation: "transport-write" }]),
    );

    const [first, second] = await Promise.all([
      session.execute({ kind: "control.press", key: "UP" }),
      session.execute({ kind: "control.press", key: "DOWN" }),
    ]);

    expect([first.ordinal, second.ordinal]).toEqual([1, 2]);
    expect([first.confirmation, second.confirmation]).toEqual(["process-exit", "transport-write"]);
    expect(driver.calls).toEqual(["open", "control.press", "control.press"]);
    await session.close();
  });

  test("records unsupported execution without invoking the driver", async () => {
    const { driver, session } = await open();

    const record = await session.execute({ kind: "control.text", text: "hello" });

    expect(record).toMatchObject({ status: "failed", error: { code: "unsupported-operation" } });
    expect(driver.calls).toEqual(["open"]);
    await session.close();
  });

  test("preserves typed webOS authorization failures in operation records", async () => {
    const driver = fakeDriver();
    driver.execute = async () => {
      throw new DeviceInventoryError(
        "WEBOS_AUTHORIZATION_REQUIRED",
        "LG webOS denied the operation; explicitly re-pair the TV outside the test before retrying.",
      );
    };
    const { session } = await open(driver);
    const record = await session.execute({ kind: "control.press", key: "LEFT" });

    expect(record).toMatchObject({
      status: "failed",
      error: {
        code: "WEBOS_AUTHORIZATION_REQUIRED",
        category: "infrastructure",
        message:
          "LG webOS denied the operation; explicitly re-pair the TV outside the test before retrying.",
      },
    });
    expect(JSON.stringify(record)).not.toContain("client-key");
    await session.close();
  });

  test("redacts non-authorization webOS failures from operation records", async () => {
    const driver = fakeDriver();
    driver.execute = async () => {
      throw sanitizeWebosRequestError(
        new Error("firmware failed at ssap://capture?token=secret&client-key=raw"),
      );
    };
    const { session } = await open(driver);

    const record = await session.execute({ kind: "control.press", key: "LEFT" });

    expect(record).toMatchObject({
      status: "failed",
      error: {
        code: "WEBOS_REQUEST_FAILED",
        category: "infrastructure",
        message: "LG webOS rejected the operation.",
      },
    });
    expect(JSON.stringify(record)).not.toMatch(/secret|client-key|ssap:/);
    await session.close();
  });

  test("cancels queued work without aborting the active operation", async () => {
    let finishActive!: () => void;
    let activeAborted = false;
    const driver = fakeDriver();
    driver.execute = (_operation, options) =>
      new Promise<DriverReceipt>((resolve, reject) => {
        finishActive = () => resolve({ confirmation: "process-exit" });
        options?.signal?.addEventListener("abort", () => {
          activeAborted = true;
          reject(options.signal?.reason);
        });
      });
    const { session } = await open(driver);
    const active = session.execute({ kind: "control.press", key: "LEFT" });
    const controller = new AbortController();
    const queued = session.execute(
      { kind: "control.press", key: "RIGHT" },
      { signal: controller.signal },
    );

    controller.abort();

    await expect(queued).resolves.toMatchObject({ status: "cancelled" });
    expect(activeAborted).toBe(false);
    finishActive();
    await expect(active).resolves.toMatchObject({ status: "succeeded" });
    await session.close();
  });
});
