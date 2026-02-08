import { describe, expect, test } from "bun:test";
import { createActor, fromCallback, waitFor } from "xstate";
import type { PhilipsCredentials } from "../credentials";
import type { PairingEvent, PairingInput } from "./actors/pairing";
import type { SessionEvent, SessionInput } from "./actors/session";
import { philipsDeviceMachine } from "./device";

// biome-ignore lint/suspicious/noExplicitAny: noop stub for test isolation
const noopActor = fromCallback(() => () => {}) as any;

const testMachine = philipsDeviceMachine.provide({
  actors: {
    pairingConnection: noopActor,
    connectionManager: noopActor,
  },
});

function setupActor() {
  const actor = createActor(testMachine, { input: { platform: "philips-tv" } });
  actor.start();
  return actor;
}

function loadedWithCredentials() {
  const actor = createActor(testMachine, {
    input: {
      platform: "philips-tv",
      deviceId: "test-id",
      deviceName: "Philips TV",
      deviceIp: "192.168.1.150",
      credentials: { deviceId: "philips-dev-1", authKey: "secret-key" },
    },
  });
  actor.start();
  return actor;
}

function loadedWithoutCredentials() {
  const actor = createActor(testMachine, {
    input: {
      platform: "philips-tv",
      deviceId: "test-id",
      deviceName: "Philips TV",
      deviceIp: "192.168.1.150",
    },
  });
  actor.start();
  return actor;
}

describe("philipsDeviceMachine", () => {
  describe("initialization", () => {
    test("should start in setup state when no device info is provided", () => {
      const actor = setupActor();
      expect(actor.getSnapshot().value).toBe("setup");
    });

    test("should start in disconnected state when loaded with valid credentials", () => {
      const actor = loadedWithCredentials();
      expect(actor.getSnapshot().value).toBe("disconnected");
      expect(actor.getSnapshot().context.credentials?.authKey).toBe("secret-key");
    });

    test("should start in pairing.idle when loaded without credentials", () => {
      const actor = loadedWithoutCredentials();
      expect(actor.getSnapshot().matches({ pairing: "idle" })).toBe(true);
    });
  });

  describe("setup flow", () => {
    test("should transition to pairing.active with valid device info", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "Philips TV", ip: "192.168.1.150" });
      expect(actor.getSnapshot().matches({ pairing: { active: "connecting" } })).toBe(true);
      expect(actor.getSnapshot().context.deviceName).toBe("Philips TV");
      expect(actor.getSnapshot().context.deviceId).not.toBeNull();
    });

    test("should set validation error when device name is empty", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "", ip: "192.168.1.150" });
      expect(actor.getSnapshot().value).toBe("setup");
      expect(actor.getSnapshot().context.error).toBe("Device name is required");
    });

    test("should set validation error when IP is invalid", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "Philips TV", ip: "nope" });
      expect(actor.getSnapshot().value).toBe("setup");
      expect(actor.getSnapshot().context.error).toBe("Invalid IP address");
    });
  });

  describe("pairing flow", () => {
    test("should transition to waitingForPin on PROMPT_RECEIVED", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "Philips TV", ip: "192.168.1.150" });
      actor.send({ type: "PROMPT_RECEIVED" });
      expect(actor.getSnapshot().matches({ pairing: { active: "waitingForPin" } })).toBe(true);
      expect(actor.getSnapshot().context.promptReceived).toBe(true);
    });

    test("should transition to confirming on SUBMIT_PIN", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "Philips TV", ip: "192.168.1.150" });
      actor.send({ type: "PROMPT_RECEIVED" });
      actor.send({ type: "SUBMIT_PIN", pin: "1234" });
      expect(actor.getSnapshot().matches({ pairing: { active: "confirming" } })).toBe(true);
    });

    test("should store credentials and transition to disconnected on PAIRED", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "Philips TV", ip: "192.168.1.150" });
      actor.send({ type: "PROMPT_RECEIVED" });
      actor.send({ type: "SUBMIT_PIN", pin: "1234" });
      actor.send({
        type: "PAIRED",
        credentials: { deviceId: "philips-dev-1", authKey: "new-auth-key" },
      });
      expect(actor.getSnapshot().value).toBe("disconnected");
      expect(actor.getSnapshot().context.credentials?.authKey).toBe("new-auth-key");
      expect(actor.getSnapshot().context.credentials?.deviceId).toBe("philips-dev-1");
    });

    test("should transition to pairing.active.error on PAIRING_ERROR", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "Philips TV", ip: "192.168.1.150" });
      actor.send({ type: "PAIRING_ERROR", error: "Wrong PIN" });
      expect(actor.getSnapshot().matches({ pairing: { active: "error" } })).toBe(true);
      expect(actor.getSnapshot().context.error).toBe("Wrong PIN");
    });
  });

  describe("session and retry logic", () => {
    test("should transition to session on CONNECT from disconnected", () => {
      const actor = loadedWithCredentials();
      actor.send({ type: "CONNECT" });
      expect(actor.getSnapshot().matches({ session: {} })).toBe(true);
    });

    test("should increment retry on CONNECTION_LOST when canRetry", () => {
      const actor = loadedWithCredentials();
      actor.send({ type: "CONNECT" });
      actor.send({ type: "CONNECTION_LOST", error: "Timeout" });
      expect(actor.getSnapshot().matches({ session: { connection: "retrying" } })).toBe(true);
      expect(actor.getSnapshot().context.retryCount).toBe(1);
    });

    test("should transition to error when retries exhausted", () => {
      const actor = loadedWithCredentials();
      actor.send({ type: "CONNECT" });

      for (let i = 0; i < 5; i++) {
        actor.send({ type: "CONNECTION_LOST", error: "Timeout" });
        if (i < 4) {
          actor.send({ type: "CONNECTED" });
          actor.send({ type: "CONNECTION_LOST", error: "Timeout" });
        }
      }

      expect(actor.getSnapshot().value).toBe("error");
      expect(actor.getSnapshot().context.error).toBe("Max retries exceeded");
    });
  });

  describe("forget", () => {
    test("should clear credentials when FORGET from disconnected", () => {
      const actor = loadedWithCredentials();
      expect(actor.getSnapshot().context.credentials?.authKey).toBe("secret-key");

      actor.send({ type: "FORGET" });
      expect(actor.getSnapshot().matches({ pairing: "idle" })).toBe(true);
      expect(actor.getSnapshot().context.credentials).toBeUndefined();
    });
  });

  describe("actor integration", () => {
    test("should complete full pairing flow with PIN confirmation", async () => {
      const mockCredentials: PhilipsCredentials = { deviceId: "dev-1", authKey: "final-key" };

      const mockPairingActor = fromCallback<PairingEvent, PairingInput>(({ sendBack, receive }) => {
        Promise.resolve().then(() => sendBack({ type: "PROMPT_RECEIVED" }));

        receive((event) => {
          if (event.type === "SUBMIT_PIN") {
            Promise.resolve().then(() =>
              sendBack({ type: "PAIRED", credentials: mockCredentials }),
            );
          }
        });

        return () => {};
      });

      const machine = philipsDeviceMachine.provide({
        actors: { pairingConnection: mockPairingActor, connectionManager: noopActor },
      });

      const actor = createActor(machine, { input: { platform: "philips-tv" } });
      actor.start();
      actor.send({ type: "SET_DEVICE_INFO", name: "Philips TV", ip: "192.168.1.150" });

      await waitFor(actor, (s) => s.matches({ pairing: { active: "waitingForPin" } }));
      actor.send({ type: "SUBMIT_PIN", pin: "1234" });

      const snapshot = await waitFor(actor, (s) => s.matches("disconnected"));
      expect(snapshot.context.credentials?.authKey).toBe("final-key");
      expect(snapshot.context.credentials?.deviceId).toBe("dev-1");
      actor.stop();
    });

    test("should handle pairing error from actor", async () => {
      const mockPairingActor = fromCallback<PairingEvent, PairingInput>(({ sendBack }) => {
        Promise.resolve().then(() => sendBack({ type: "PAIRING_ERROR", error: "TV unreachable" }));
        return () => {};
      });

      const machine = philipsDeviceMachine.provide({
        actors: { pairingConnection: mockPairingActor, connectionManager: noopActor },
      });

      const actor = createActor(machine, { input: { platform: "philips-tv" } });
      actor.start();
      actor.send({ type: "SET_DEVICE_INFO", name: "Philips TV", ip: "192.168.1.150" });

      const snapshot = await waitFor(actor, (s) => s.matches({ pairing: { active: "error" } }));
      expect(snapshot.context.error).toBe("TV unreachable");
      actor.stop();
    });

    test("should connect and reach connected state via session actor", async () => {
      const mockSessionActor = fromCallback<SessionEvent, SessionInput>(({ sendBack }) => {
        Promise.resolve().then(() => sendBack({ type: "CONNECTED" }));
        return () => {};
      });

      const machine = philipsDeviceMachine.provide({
        actors: { pairingConnection: noopActor, connectionManager: mockSessionActor },
      });

      const actor = createActor(machine, {
        input: {
          platform: "philips-tv",
          deviceId: "test-id",
          deviceName: "Philips TV",
          deviceIp: "192.168.1.150",
          credentials: { deviceId: "dev-1", authKey: "auth-key" },
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
  });
});
