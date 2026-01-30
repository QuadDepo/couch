import { describe, expect, test } from "bun:test";
import { createActor, fromCallback, waitFor } from "xstate";
import { webosDeviceMachine } from "./device";

// biome-ignore lint/suspicious/noExplicitAny: noop stub for test isolation
const noopActor = fromCallback(() => () => {}) as any;

const testMachine = webosDeviceMachine.provide({
  actors: {
    pairingConnection: noopActor,
    connectionManager: noopActor,
  },
});

function setupActor() {
  const actor = createActor(testMachine, { input: { platform: "lg-webos" } });
  actor.start();
  return actor;
}

function loadedWithCredentials() {
  const actor = createActor(testMachine, {
    input: {
      platform: "lg-webos",
      deviceId: "test-id",
      deviceName: "LG TV",
      deviceIp: "192.168.1.200",
      credentials: { clientKey: "abc123" },
    },
  });
  actor.start();
  return actor;
}

function loadedWithoutCredentials() {
  const actor = createActor(testMachine, {
    input: {
      platform: "lg-webos",
      deviceId: "test-id",
      deviceName: "LG TV",
      deviceIp: "192.168.1.200",
    },
  });
  actor.start();
  return actor;
}

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
  });

  describe("session and retry logic", () => {
    test("should transition to session on CONNECT from disconnected", () => {
      const actor = loadedWithCredentials();
      actor.send({ type: "CONNECT" });
      expect(actor.getSnapshot().matches({ session: {} })).toBe(true);
    });

    test("should transition to session.connection.connected on CONNECTED", () => {
      const actor = loadedWithCredentials();
      actor.send({ type: "CONNECT" });
      actor.send({ type: "CONNECTED" });
      expect(
        actor.getSnapshot().matches({ session: { connection: "connected", heartbeat: "idle" } }),
      ).toBe(true);
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
      expect(actor.getSnapshot().context.credentials?.clientKey).toBe("abc123");

      actor.send({ type: "FORGET" });
      expect(actor.getSnapshot().matches({ pairing: "idle" })).toBe(true);
      expect(actor.getSnapshot().context.credentials).toBeUndefined();
    });
  });

  describe("actor integration", () => {
    test("should complete full pairing flow and store credentials", async () => {
      const mockPairingActor = fromCallback<
        | { type: "PROMPT_RECEIVED" }
        | { type: "PAIRED"; clientKey: string }
        | { type: "PAIRING_ERROR"; error: string }
      >(({ sendBack }) => {
        sendBack({ type: "PROMPT_RECEIVED" });
        Promise.resolve().then(() => sendBack({ type: "PAIRED", clientKey: "paired-key" }));
        return () => {};
      });

      const machine = webosDeviceMachine.provide({
        actors: { pairingConnection: mockPairingActor, connectionManager: noopActor },
      });

      const actor = createActor(machine, { input: { platform: "lg-webos" } });
      actor.start();
      actor.send({ type: "SET_DEVICE_INFO", name: "LG TV", ip: "192.168.1.200" });

      const snapshot = await waitFor(actor, (s) => s.matches("disconnected"));
      expect(snapshot.context.credentials?.clientKey).toBe("paired-key");
      actor.stop();
    });

    test("should handle pairing error from actor", async () => {
      const mockPairingActor = fromCallback<
        | { type: "PROMPT_RECEIVED" }
        | { type: "PAIRED"; clientKey: string }
        | { type: "PAIRING_ERROR"; error: string }
      >(({ sendBack }) => {
        Promise.resolve().then(() => sendBack({ type: "PAIRING_ERROR", error: "TV rejected" }));
        return () => {};
      });

      const machine = webosDeviceMachine.provide({
        actors: { pairingConnection: mockPairingActor, connectionManager: noopActor },
      });

      const actor = createActor(machine, { input: { platform: "lg-webos" } });
      actor.start();
      actor.send({ type: "SET_DEVICE_INFO", name: "LG TV", ip: "192.168.1.200" });

      const snapshot = await waitFor(actor, (s) => s.matches({ pairing: { active: "error" } }));
      expect(snapshot.context.error).toBe("TV rejected");
      actor.stop();
    });

    test("should connect and reach connected state via session actor", async () => {
      const mockSessionActor = fromCallback<
        { type: "CONNECTED" } | { type: "CONNECTION_LOST"; error?: string }
      >(({ sendBack }) => {
        Promise.resolve().then(() => sendBack({ type: "CONNECTED" }));
        return () => {};
      });

      const machine = webosDeviceMachine.provide({
        actors: { pairingConnection: noopActor, connectionManager: mockSessionActor },
      });

      const actor = createActor(machine, {
        input: {
          platform: "lg-webos",
          deviceId: "test-id",
          deviceName: "LG TV",
          deviceIp: "192.168.1.200",
          credentials: { clientKey: "abc123" },
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
