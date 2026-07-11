import { describe, expect, test } from "bun:test";
import { createActor, fromCallback, waitFor } from "xstate";
import type { PairingEvent, PairingInput } from "./actors/pairing";
import type { SessionEvent, SessionInput } from "./actors/session";
import { androidTVDeviceMachine } from "./device";

// Shared skeleton behavior (init, setup/validation, pairing, session, heartbeat,
// forget, error recovery, timeouts) is covered by ../../shared/machine.test.ts.
// This suite covers only the ADB instruction wizard and actor integration.

// biome-ignore lint/suspicious/noExplicitAny: noop stub for test isolation
const noopActor = fromCallback(() => () => {}) as any;

const testMachine = androidTVDeviceMachine.provide({
  actors: {
    pairingConnection: noopActor,
    connectionManager: noopActor,
  },
});

function setupActor() {
  const actor = createActor(testMachine, { input: { platform: "android-tv" } });
  actor.start();
  return actor;
}

describe("androidTVDeviceMachine", () => {
  describe("instruction wizard", () => {
    test("should advance instruction step on CONTINUE_INSTRUCTION", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "192.168.1.50" });
      expect(actor.getSnapshot().context.instructionStep).toBe(0);

      actor.send({ type: "CONTINUE_INSTRUCTION" });
      expect(actor.getSnapshot().context.instructionStep).toBe(1);
      expect(actor.getSnapshot().matches({ pairing: "instructions" })).toBe(true);
    });

    test("should transition to pairing.active after last instruction step", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "192.168.1.50" });

      // Step 0 -> Step 1
      actor.send({ type: "CONTINUE_INSTRUCTION" });
      // Step 1 -> active (only 2 steps total)
      actor.send({ type: "CONTINUE_INSTRUCTION" });

      expect(actor.getSnapshot().matches({ pairing: { active: "connecting" } })).toBe(true);
    });

    test("should go back one instruction step on BACK_INSTRUCTION", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "192.168.1.50" });
      actor.send({ type: "CONTINUE_INSTRUCTION" });
      expect(actor.getSnapshot().context.instructionStep).toBe(1);

      actor.send({ type: "BACK_INSTRUCTION" });
      expect(actor.getSnapshot().context.instructionStep).toBe(0);
    });

    test("should return to setup on BACK_INSTRUCTION from step 0", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "192.168.1.50" });
      expect(actor.getSnapshot().context.instructionStep).toBe(0);

      actor.send({ type: "BACK_INSTRUCTION" });
      expect(actor.getSnapshot().value).toBe("setup");
      expect(actor.getSnapshot().context.deviceId).toBeNull();
    });
  });

  describe("actor integration", () => {
    test("should complete full pairing flow with successful connection actor", async () => {
      const mockPairingActor = fromCallback<PairingEvent, PairingInput>(({ sendBack }) => {
        sendBack({ type: "PROMPT_RECEIVED" });
        Promise.resolve().then(() => sendBack({ type: "PAIRED" }));
        return () => {};
      });

      const machine = androidTVDeviceMachine.provide({
        actors: { pairingConnection: mockPairingActor, connectionManager: noopActor },
      });

      const actor = createActor(machine, { input: { platform: "android-tv" } });
      actor.start();

      actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "192.168.1.50" });
      actor.send({ type: "CONTINUE_INSTRUCTION" });
      actor.send({ type: "CONTINUE_INSTRUCTION" });

      const snapshot = await waitFor(actor, (s) => s.matches("disconnected"));
      expect(snapshot.value).toBe("disconnected");
      expect(snapshot.context.deviceId).not.toBeNull();
      actor.stop();
    });

    test("should handle pairing error from actor", async () => {
      const mockPairingActor = fromCallback<PairingEvent, PairingInput>(({ sendBack }) => {
        sendBack({ type: "PROMPT_RECEIVED" });
        Promise.resolve().then(() =>
          sendBack({ type: "PAIRING_ERROR", error: "Connection refused" }),
        );
        return () => {};
      });

      const machine = androidTVDeviceMachine.provide({
        actors: { pairingConnection: mockPairingActor, connectionManager: noopActor },
      });

      const actor = createActor(machine, { input: { platform: "android-tv" } });
      actor.start();

      actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "192.168.1.50" });
      actor.send({ type: "CONTINUE_INSTRUCTION" });
      actor.send({ type: "CONTINUE_INSTRUCTION" });

      const snapshot = await waitFor(actor, (s) => s.matches({ pairing: { active: "error" } }));
      expect(snapshot.context.error).toBe("Connection refused");
      actor.stop();
    });

    test("should connect and reach connected state via session actor", async () => {
      const mockSessionActor = fromCallback<SessionEvent, SessionInput>(({ sendBack }) => {
        Promise.resolve().then(() => sendBack({ type: "CONNECTED" }));
        return () => {};
      });

      const machine = androidTVDeviceMachine.provide({
        actors: { pairingConnection: noopActor, connectionManager: mockSessionActor },
      });

      const actor = createActor(machine, {
        input: {
          platform: "android-tv",
          deviceId: "test-id",
          deviceName: "My TV",
          deviceIp: "192.168.1.50",
        },
      });
      actor.start();
      actor.send({ type: "CONNECT" });

      const snapshot = await waitFor(actor, (s) =>
        s.matches({ session: { connection: "connected" } }),
      );
      expect(snapshot.context.retryCount).toBe(0);
      actor.stop();
    });

    test("should handle connection failure from session actor", async () => {
      const mockSessionActor = fromCallback<SessionEvent, SessionInput>(({ sendBack }) => {
        Promise.resolve().then(() =>
          sendBack({ type: "CONNECTION_LOST", error: "Network unreachable" }),
        );
        return () => {};
      });

      const machine = androidTVDeviceMachine.provide({
        actors: { pairingConnection: noopActor, connectionManager: mockSessionActor },
      });

      const actor = createActor(machine, {
        input: {
          platform: "android-tv",
          deviceId: "test-id",
          deviceName: "My TV",
          deviceIp: "192.168.1.50",
        },
      });
      actor.start();
      actor.send({ type: "CONNECT" });

      const snapshot = await waitFor(actor, (s) =>
        s.matches({ session: { connection: "retrying" } }),
      );
      expect(snapshot.context.retryCount).toBe(1);
      expect(snapshot.context.error).toBe("Network unreachable");
      actor.stop();
    });
  });
});
