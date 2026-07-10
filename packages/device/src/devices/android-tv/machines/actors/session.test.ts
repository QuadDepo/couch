import { describe, expect, test } from "bun:test";
import { createActor } from "xstate";
import type { DeviceDriver } from "../../../../drivers/types";
import { awaitSessionHandoff } from "../../../shared/sessionHandoff";
import { createAndroidTvSessionActor, type SessionInput } from "./session";

const input: SessionInput = {
  deviceId: "living-room",
  deviceName: "Living Room",
  ip: "192.0.2.10",
};

async function waitForCall(calls: string[], expected: string): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!calls.includes(expected)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${expected}`);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function fakeDriver(calls: string[]): DeviceDriver {
  return {
    adapterId: "adb",
    open: () => {
      calls.push("open");
    },
    isReady: () => true,
    execute: async (operation, { signal }) => {
      calls.push(`execute:${operation.kind}`);
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => {
            calls.push("abort");
            reject(signal.reason);
          },
          { once: true },
        );
      });
      return { confirmation: "process-exit" };
    },
    close: () => {
      calls.push("close");
    },
  };
}

describe("Android TV session actor", () => {
  test("aborts operations and releases the lock only after teardown settles", async () => {
    const calls: string[] = [];
    const actor = createActor(
      createAndroidTvSessionActor({
        lockDirectory: "/tmp/couch-session-test",
        createDriver: () => fakeDriver(calls),
        createLock: () => ({
          acquire: async () => ({
            owner: {
              pid: process.pid,
              runId: "test",
              acquiredAt: "now",
              resourceId: "adb:192.0.2.10:5555",
              token: "token",
            },
            release: async () => calls.push("release"),
          }),
        }),
      }),
      { input },
    );
    actor.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    actor.stop();
    await awaitSessionHandoff("adb:192.0.2.10:5555");

    expect(calls).toEqual(["open", "execute:device.wake", "abort", "close", "release"]);
  });

  test("makes a reconnect wait for the outgoing operation, close, and release", async () => {
    const calls: string[] = [];
    let settleOperation!: () => void;
    let settleClose!: () => void;
    const operationDone = new Promise<void>((resolve) => {
      settleOperation = resolve;
    });
    const closeDone = new Promise<void>((resolve) => {
      settleClose = resolve;
    });
    let driverCount = 0;
    let lockCount = 0;

    const actorLogic = createAndroidTvSessionActor({
      lockDirectory: "/tmp/couch-session-test",
      createDriver: () => {
        driverCount += 1;
        const current = driverCount;
        return {
          adapterId: "adb",
          open: () => calls.push(`open${current}`),
          isReady: () => true,
          execute: async (_operation, { signal }) => {
            calls.push(`execute${current}`);
            if (current === 1) {
              signal?.addEventListener("abort", () => calls.push("abort1"), { once: true });
              await operationDone;
            }
            return { confirmation: "process-exit" as const };
          },
          close: async () => {
            calls.push(`close${current}`);
            if (current === 1) await closeDone;
          },
        };
      },
      createLock: () => ({
        acquire: async () => {
          lockCount += 1;
          const current = lockCount;
          calls.push(`acquire${current}`);
          return {
            owner: {
              pid: process.pid,
              runId: `test-${current}`,
              acquiredAt: "now",
              resourceId: "adb:192.0.2.10:5555",
              token: `token-${current}`,
            },
            release: async () => calls.push(`release${current}`),
          };
        },
      }),
    });

    const outgoing = createActor(actorLogic, { input });
    outgoing.start();
    await waitForCall(calls, "execute1");

    outgoing.stop();
    const reconnecting = createActor(actorLogic, { input });
    reconnecting.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).not.toContain("acquire2");

    settleOperation();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).not.toContain("acquire2");

    settleClose();
    await waitForCall(calls, "open2");
    expect(calls.indexOf("release1")).toBeLessThan(calls.indexOf("acquire2"));
    reconnecting.stop();
    await awaitSessionHandoff("adb:192.0.2.10:5555");
  });
});
