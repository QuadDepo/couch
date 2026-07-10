import { describe, expect, test } from "bun:test";
import { createActor, fromCallback, waitFor } from "xstate";
import type { PairingEvent, PairingInput } from "./actors/pairing";
import { webosDeviceMachine } from "./device";
import {
  loadedWithCredentials,
  loadedWithoutCredentials,
  noopActor,
  setupActor,
} from "./deviceTestSupport";

describe("webosDeviceMachine", () => {
  describe("initialization", () => {
    test("should start in setup state when no device info is provided", () => {
      const actor = setupActor();
      expect(actor.getSnapshot().value).toBe("setup");
    });

    test("should start in disconnected state when loaded with valid credentials", () => {
      const actor = loadedWithCredentials();
      expect(actor.getSnapshot().value).toBe("disconnected");
      expect(actor.getSnapshot().context.credentials?.clientKey).toBe("abc123");
    });

    test("should start in pairing.idle when loaded without credentials", () => {
      const actor = loadedWithoutCredentials();
      expect(actor.getSnapshot().matches({ pairing: "idle" })).toBe(true);
    });
  });

  describe("setup flow", () => {
    test("should transition to pairing.active with valid device info", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "LG TV", ip: "192.168.1.200" });
      expect(actor.getSnapshot().matches({ pairing: { active: "connecting" } })).toBe(true);
      expect(actor.getSnapshot().context.deviceName).toBe("LG TV");
      expect(actor.getSnapshot().context.deviceId).not.toBeNull();
    });

    test("should set validation error when device name is empty", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "", ip: "192.168.1.200" });
      expect(actor.getSnapshot().value).toBe("setup");
      expect(actor.getSnapshot().context.error).toBe("Device name is required");
    });

    test("should set validation error when IP is invalid", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "LG TV", ip: "bad-ip" });
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

  describe("pairing flow", () => {
    test("should transition to pairing.active.waitingForUser on PROMPT_RECEIVED", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "LG TV", ip: "192.168.1.200" });
      actor.send({ type: "PROMPT_RECEIVED" });
      expect(actor.getSnapshot().matches({ pairing: { active: "waitingForUser" } })).toBe(true);
      expect(actor.getSnapshot().context.promptReceived).toBe(true);
    });

    test("should store credentials and transition to disconnected on PAIRED", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "LG TV", ip: "192.168.1.200" });
      actor.send({ type: "PAIRED", clientKey: "new-key-123" });
      expect(actor.getSnapshot().value).toBe("disconnected");
      expect(actor.getSnapshot().context.credentials?.clientKey).toBe("new-key-123");
    });

    test("should transition to pairing.active.error on PAIRING_ERROR", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "LG TV", ip: "192.168.1.200" });
      actor.send({ type: "PAIRING_ERROR", error: "Rejected by user" });
      expect(actor.getSnapshot().matches({ pairing: { active: "error" } })).toBe(true);
      expect(actor.getSnapshot().context.error).toBe("Rejected by user");
    });

    test("should enable SSL and retry pairing on ECONNRESET error", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "LG TV", ip: "192.168.1.200" });
      expect(actor.getSnapshot().context.useSsl).toBe(false);

      actor.send({ type: "PAIRING_ERROR", error: "ECONNRESET" });
      expect(actor.getSnapshot().matches({ pairing: { active: "connecting" } })).toBe(true);
      expect(actor.getSnapshot().context.useSsl).toBe(true);
    });

    test("should enable SSL when Bun reports a generic WebSocket failure", () => {
      let starts = 0;
      const countingPairingActor = fromCallback(() => {
        starts += 1;
        return () => {};
      });
      const machine = webosDeviceMachine.provide({
        actors: { pairingConnection: countingPairingActor, connectionManager: noopActor },
      });
      const actor = createActor(machine, { input: { platform: "lg-webos" } }).start();
      actor.send({ type: "SET_DEVICE_INFO", name: "LG TV", ip: "192.168.1.200" });

      actor.send({ type: "PAIRING_ERROR", error: "Error: WebSocket connection failed" });

      expect(starts).toBe(2);
      expect(actor.getSnapshot().matches({ pairing: { active: "connecting" } })).toBe(true);
      expect(actor.getSnapshot().context.useSsl).toBe(true);
    });

    test("should restart the pairing actor and reset prompt state on retry", async () => {
      let starts = 0;
      const retryingPairingActor = fromCallback<PairingEvent, PairingInput>(({ sendBack }) => {
        starts += 1;
        if (starts === 1) {
          queueMicrotask(() => {
            sendBack({ type: "PROMPT_RECEIVED" });
            sendBack({ type: "PAIRING_ERROR", error: "Rejected by user" });
          });
        }
        return () => {};
      });
      const machine = webosDeviceMachine.provide({
        actors: { pairingConnection: retryingPairingActor, connectionManager: noopActor },
      });
      const actor = createActor(machine, { input: { platform: "lg-webos" } }).start();
      actor.send({ type: "SET_DEVICE_INFO", name: "LG TV", ip: "192.168.1.200" });
      await waitFor(actor, (snapshot) => snapshot.matches({ pairing: { active: "error" } }));

      actor.send({ type: "START_PAIRING" });

      expect(starts).toBe(2);
      expect(actor.getSnapshot().matches({ pairing: { active: "connecting" } })).toBe(true);
      expect(actor.getSnapshot().context.promptReceived).toBe(false);
    });
  });
});
