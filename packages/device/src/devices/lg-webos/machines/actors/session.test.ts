import { describe, expect, test } from "bun:test";
import { createActor } from "xstate";
import type { DeviceDriver } from "../../../../drivers/types";
import { awaitSessionHandoff } from "../../../shared/sessionHandoff";
import type { WebOSConnection } from "../../connectionTypes";
import { createLgWebosSessionActor } from "./session";
import type { SessionInput } from "./sessionActorTypes";

const input: SessionInput = {
  deviceId: "living-room-webos",
  deviceName: "Living Room",
  ip: "192.0.2.20",
  credentials: { clientKey: "client-key" },
};

async function waitForCall(calls: string[], expected: string): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!calls.includes(expected)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${expected}`);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("LG webOS session actor", () => {
  test("publishes teardown before releasing the device lock", async () => {
    const calls: string[] = [];
    let settleOperation!: () => void;
    const operationDone = new Promise<void>((resolve) => {
      settleOperation = resolve;
    });
    const driver: DeviceDriver = {
      adapterId: "lg-ssap",
      open: () => calls.push("open"),
      isReady: () => true,
      execute: async (_operation, { signal }) => {
        calls.push("execute");
        signal?.addEventListener("abort", () => calls.push("abort"), { once: true });
        await operationDone;
        return { confirmation: "protocol-response" };
      },
      close: () => calls.push("close"),
    };
    const actor = createActor(
      createLgWebosSessionActor({
        lockDirectory: "/tmp/couch-session-test",
        createConnection: () => ({ on: () => undefined }) as unknown as WebOSConnection,
        createDriver: () => driver,
        createLock: () => ({
          acquire: async () => ({
            owner: {
              pid: process.pid,
              runId: "test",
              acquiredAt: "now",
              resourceId: "device:living-room-webos",
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
    actor.send({ type: "SEND_KEY", key: "LEFT" });
    await waitForCall(calls, "execute");
    actor.stop();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).not.toContain("release");

    settleOperation();
    await awaitSessionHandoff("device:living-room-webos");

    expect(calls).toEqual(["open", "execute", "abort", "close", "release"]);
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
    const actorLogic = createLgWebosSessionActor({
      lockDirectory: "/tmp/couch-session-test",
      createConnection: () => ({ on: () => undefined }) as unknown as WebOSConnection,
      createDriver: () => {
        driverCount += 1;
        const current = driverCount;
        return {
          adapterId: "lg-ssap",
          open: () => calls.push(`open${current}`),
          isReady: () => true,
          execute: async (_operation, { signal }) => {
            calls.push(`execute${current}`);
            if (current === 1) {
              signal?.addEventListener("abort", () => calls.push("abort1"), { once: true });
              await operationDone;
            }
            return { confirmation: "protocol-response" as const };
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
              resourceId: "device:living-room-webos",
              token: `token-${current}`,
            },
            release: async () => calls.push(`release${current}`),
          };
        },
      }),
    });

    const outgoing = createActor(actorLogic, { input });
    outgoing.start();
    await waitForCall(calls, "open1");
    outgoing.send({ type: "SEND_KEY", key: "LEFT" });
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
    await awaitSessionHandoff("device:living-room-webos");
  });
});
