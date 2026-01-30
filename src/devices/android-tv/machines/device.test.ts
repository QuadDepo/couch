import { describe, expect, test } from "bun:test";
import { createActor, fromCallback, waitFor } from "xstate";
import { androidTVDeviceMachine } from "./device";

const noopActor = fromCallback(() => () => {});

const testMachine = androidTVDeviceMachine.provide({
  actors: {
    pairingConnection: noopActor,
    connectionManager: noopActor,
  },
});

function setupActor(input?: Parameters<typeof createActor<typeof testMachine>>[1]) {
  const actor = createActor(testMachine, input ?? { input: { platform: "android-tv" } });
  actor.start();
  return actor;
}

function loadedActor() {
  return setupActor({
    input: {
      platform: "android-tv",
      deviceId: "test-id",
      deviceName: "Living Room TV",
      deviceIp: "192.168.1.100",
    },
  });
}

describe("androidTVDeviceMachine", () => {
  describe("guards", () => {
    test("should start in setup state when no device info is provided", () => {
      const actor = setupActor();
      expect(actor.getSnapshot().value).toBe("setup");
    });

    test("should start in disconnected state when device info is provided", () => {
      const actor = loadedActor();
      expect(actor.getSnapshot().value).toBe("disconnected");
    });
  });

  describe("setup flow", () => {
    test("should transition to pairing.instructions with valid device info", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "192.168.1.50" });
      expect(actor.getSnapshot().matches({ pairing: "instructions" })).toBe(true);
      expect(actor.getSnapshot().context.deviceName).toBe("My TV");
      expect(actor.getSnapshot().context.deviceIp).toBe("192.168.1.50");
      expect(actor.getSnapshot().context.deviceId).not.toBeNull();
    });

    test("should set validation error when device name is empty", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "", ip: "192.168.1.50" });
      expect(actor.getSnapshot().value).toBe("setup");
      expect(actor.getSnapshot().context.error).toBe("Device name is required");
    });

    test("should set validation error when IP is invalid", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "not-an-ip" });
      expect(actor.getSnapshot().value).toBe("setup");
      expect(actor.getSnapshot().context.error).toBe("Invalid IP address");
    });

    test("should transition to cancelled on CANCEL from setup", () => {
      const actor = setupActor();
      actor.send({ type: "CANCEL" });
      expect(actor.getSnapshot().value).toBe("cancelled");
      expect(actor.getSnapshot().status).toBe("done");
    });
  });

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

  describe("pairing flow", () => {
    test("should transition to pairing.active.waitingForUser on PROMPT_RECEIVED", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "192.168.1.50" });
      actor.send({ type: "CONTINUE_INSTRUCTION" });
      actor.send({ type: "CONTINUE_INSTRUCTION" });

      actor.send({ type: "PROMPT_RECEIVED" });
      expect(actor.getSnapshot().matches({ pairing: { active: "waitingForUser" } })).toBe(true);
      expect(actor.getSnapshot().context.promptReceived).toBe(true);
    });

    test("should transition to disconnected on PAIRED", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "192.168.1.50" });
      actor.send({ type: "CONTINUE_INSTRUCTION" });
      actor.send({ type: "CONTINUE_INSTRUCTION" });

      actor.send({ type: "PAIRED" });
      expect(actor.getSnapshot().value).toBe("disconnected");
    });

    test("should transition to pairing.active.error on PAIRING_ERROR", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "192.168.1.50" });
      actor.send({ type: "CONTINUE_INSTRUCTION" });
      actor.send({ type: "CONTINUE_INSTRUCTION" });

      actor.send({ type: "PAIRING_ERROR", error: "Connection refused" });
      expect(actor.getSnapshot().matches({ pairing: { active: "error" } })).toBe(true);
      expect(actor.getSnapshot().context.error).toBe("Connection refused");
    });
  });

  describe("session and retry logic", () => {
    test("should transition to session on CONNECT from disconnected", () => {
      const actor = loadedActor();
      actor.send({ type: "CONNECT" });
      expect(actor.getSnapshot().matches({ session: {} })).toBe(true);
    });

    test("should transition to session.connection.connected on CONNECTED", () => {
      const actor = loadedActor();
      actor.send({ type: "CONNECT" });
      actor.send({ type: "CONNECTED" });
      expect(
        actor.getSnapshot().matches({ session: { connection: "connected", heartbeat: "idle" } }),
      ).toBe(true);
    });

    test("should increment retry and go to retrying on CONNECTION_LOST when canRetry", () => {
      const actor = loadedActor();
      actor.send({ type: "CONNECT" });
      actor.send({ type: "CONNECTION_LOST", error: "Timeout" });

      expect(
        actor.getSnapshot().matches({ session: { connection: "retrying" } }),
      ).toBe(true);
      expect(actor.getSnapshot().context.retryCount).toBe(1);
      expect(actor.getSnapshot().context.error).toBe("Timeout");
    });

    test("should transition to error when retries exhausted on CONNECTION_LOST", () => {
      const actor = loadedActor();
      actor.send({ type: "CONNECT" });

      for (let i = 0; i < 5; i++) {
        actor.send({ type: "CONNECTION_LOST", error: "Timeout" });
        if (i < 4) {
          // Re-enter session by waiting for retry delay — instead, re-send CONNECT
          // The machine uses `after: retryDelay` which we can't easily wait for in tests.
          // So we manually re-enter session state for testing purposes.
          actor.send({ type: "CONNECTED" });
          actor.send({ type: "CONNECTION_LOST", error: "Timeout" });
        }
      }

      // After maxRetries (5), should be in error state
      expect(actor.getSnapshot().value).toBe("error");
    });

    test("should reset retry count on CONNECTED from connecting state", () => {
      const actor = loadedActor();
      actor.send({ type: "CONNECT" });
      expect(actor.getSnapshot().matches({ session: { connection: "connecting" } })).toBe(true);

      actor.send({ type: "CONNECTED" });
      expect(actor.getSnapshot().context.retryCount).toBe(0);
      expect(actor.getSnapshot().context.error).toBeUndefined();
    });
  });

  describe("error state", () => {
    test("should allow CONNECT from error state", () => {
      const actor = loadedActor();
      actor.send({ type: "CONNECT" });

      // Exhaust retries to reach error state
      for (let i = 0; i < 5; i++) {
        actor.send({ type: "CONNECTION_LOST" });
        if (i < 4) {
          actor.send({ type: "CONNECTED" });
          actor.send({ type: "CONNECTION_LOST" });
        }
      }
      expect(actor.getSnapshot().value).toBe("error");

      actor.send({ type: "CONNECT" });
      expect(actor.getSnapshot().matches({ session: {} })).toBe(true);
      expect(actor.getSnapshot().context.retryCount).toBe(0);
    });

    test("should allow DISCONNECT from error state back to disconnected", () => {
      const actor = loadedActor();
      actor.send({ type: "CONNECT" });

      for (let i = 0; i < 5; i++) {
        actor.send({ type: "CONNECTION_LOST" });
        if (i < 4) {
          actor.send({ type: "CONNECTED" });
          actor.send({ type: "CONNECTION_LOST" });
        }
      }
      expect(actor.getSnapshot().value).toBe("error");

      actor.send({ type: "DISCONNECT" });
      expect(actor.getSnapshot().value).toBe("disconnected");
    });
  });

  describe("actor integration", () => {
    test("should complete full pairing flow with successful connection actor", async () => {
      const mockPairingActor = fromCallback<
        { type: "PROMPT_RECEIVED" } | { type: "PAIRED" } | { type: "PAIRING_ERROR"; error: string }
      >(({ sendBack }) => {
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
      const mockPairingActor = fromCallback<
        { type: "PROMPT_RECEIVED" } | { type: "PAIRED" } | { type: "PAIRING_ERROR"; error: string }
      >(({ sendBack }) => {
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

      const snapshot = await waitFor(actor, (s) =>
        s.matches({ pairing: { active: "error" } }),
      );
      expect(snapshot.context.error).toBe("Connection refused");
      actor.stop();
    });

    test("should connect and reach connected state via session actor", async () => {
      const mockSessionActor = fromCallback<
        { type: "CONNECTED" } | { type: "CONNECTION_LOST"; error?: string }
      >(({ sendBack }) => {
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
      const mockSessionActor = fromCallback<
        { type: "CONNECTED" } | { type: "CONNECTION_LOST"; error?: string }
      >(({ sendBack }) => {
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
