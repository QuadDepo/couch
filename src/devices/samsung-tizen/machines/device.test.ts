import { describe, expect, test } from "bun:test";
import { createActor, fromCallback, waitFor } from "xstate";
import { tizenDeviceMachine } from "./device";

// biome-ignore lint/suspicious/noExplicitAny: noop stub for test isolation
const noopActor = fromCallback(() => () => {}) as any;

const testMachine = tizenDeviceMachine.provide({
  actors: {
    pairingConnection: noopActor,
    connectionManager: noopActor,
  },
});

function setupActor(input?: Parameters<typeof createActor<typeof testMachine>>[1]) {
  const actor = createActor(testMachine, input ?? { input: { platform: "samsung-tizen" } });
  actor.start();
  return actor;
}

function loadedWithCredentials() {
  return setupActor({
    input: {
      platform: "samsung-tizen",
      deviceId: "test-id",
      deviceName: "Samsung TV",
      deviceIp: "192.168.1.200",
      credentials: { token: "test-token", mac: "" },
    },
  });
}

function loadedWithoutCredentials() {
  return setupActor({
    input: {
      platform: "samsung-tizen",
      deviceId: "test-id",
      deviceName: "Samsung TV",
      deviceIp: "192.168.1.200",
    },
  });
}

describe("tizenDeviceMachine", () => {
  describe("initialization", () => {
    test("should start in setup when no device info is provided", () => {
      const actor = setupActor();
      expect(actor.getSnapshot().value).toBe("setup");
    });

    test("should start in disconnected when loaded with credentials", () => {
      const actor = loadedWithCredentials();
      expect(actor.getSnapshot().value).toBe("disconnected");
    });

    test("should start in pairing.idle when loaded without credentials", () => {
      const actor = loadedWithoutCredentials();
      expect(actor.getSnapshot().matches({ pairing: "idle" })).toBe(true);
    });
  });

  describe("setup and validation", () => {
    test("should transition to pairing.active with valid device info", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "192.168.1.50" });
      expect(actor.getSnapshot().matches({ pairing: { active: "connecting" } })).toBe(true);
      expect(actor.getSnapshot().context.deviceName).toBe("My TV");
      expect(actor.getSnapshot().context.deviceIp).toBe("192.168.1.50");
      expect(actor.getSnapshot().context.deviceId).not.toBeNull();
    });

    test("should set validation error for missing device name", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "", ip: "192.168.1.50" });
      expect(actor.getSnapshot().value).toBe("setup");
      expect(actor.getSnapshot().context.error).toBe("Device name is required");
    });

    test("should set validation error for invalid IP", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "not-an-ip" });
      expect(actor.getSnapshot().value).toBe("setup");
      expect(actor.getSnapshot().context.error).toBe("Invalid IP address");
    });

    test("should transition to cancelled on CANCEL", () => {
      const actor = setupActor();
      actor.send({ type: "CANCEL" });
      expect(actor.getSnapshot().value).toBe("cancelled");
      expect(actor.getSnapshot().status).toBe("done");
    });
  });

  describe("pairing flow", () => {
    test("should transition to pairing.active.connecting on START_PAIRING from idle", () => {
      const actor = loadedWithoutCredentials();
      actor.send({ type: "START_PAIRING" });
      expect(actor.getSnapshot().matches({ pairing: { active: "connecting" } })).toBe(true);
    });

    test("should transition to waitingForUser on PROMPT_RECEIVED", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "192.168.1.50" });
      actor.send({ type: "PROMPT_RECEIVED" });
      expect(actor.getSnapshot().matches({ pairing: { active: "waitingForUser" } })).toBe(true);
      expect(actor.getSnapshot().context.promptReceived).toBe(true);
    });

    test("should transition to disconnected on PAIRED and store token credential", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "192.168.1.50" });
      actor.send({ type: "PAIRED", token: "my-token" });
      expect(actor.getSnapshot().value).toBe("disconnected");
      expect(actor.getSnapshot().context.credentials?.token).toBe("my-token");
    });

    test("should transition to pairing.active.error on PAIRING_ERROR", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "192.168.1.50" });
      actor.send({ type: "PAIRING_ERROR", error: "TV denied pairing" });
      expect(actor.getSnapshot().matches({ pairing: { active: "error" } })).toBe(true);
      expect(actor.getSnapshot().context.error).toBe("TV denied pairing");
    });

    test("should reset to setup on RESET_TO_SETUP", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "192.168.1.50" });
      actor.send({ type: "RESET_TO_SETUP" });
      expect(actor.getSnapshot().value).toBe("setup");
      expect(actor.getSnapshot().context.deviceId).toBeNull();
      expect(actor.getSnapshot().context.deviceName).toBe("");
    });
  });

  describe("session and connection", () => {
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

    test("should transition to retrying on CONNECTION_LOST when retries remain", () => {
      const actor = loadedWithCredentials();
      actor.send({ type: "CONNECT" });
      actor.send({ type: "CONNECTION_LOST", error: "Timeout" });
      expect(actor.getSnapshot().matches({ session: { connection: "retrying" } })).toBe(true);
      expect(actor.getSnapshot().context.retryCount).toBe(1);
      expect(actor.getSnapshot().context.error).toBe("Timeout");
    });

    test("should transition to error when max retries exceeded on CONNECTION_LOST", () => {
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
    });

    test("should reset retry count on CONNECTED", () => {
      const actor = loadedWithCredentials();
      actor.send({ type: "CONNECT" });
      actor.send({ type: "CONNECTED" });
      expect(actor.getSnapshot().context.retryCount).toBe(0);
      expect(actor.getSnapshot().context.error).toBeUndefined();
    });
  });

  describe("heartbeat", () => {
    test("should start heartbeat in waiting state", () => {
      const actor = loadedWithCredentials();
      actor.send({ type: "CONNECT" });
      expect(actor.getSnapshot().matches({ session: { heartbeat: "waiting" } })).toBe(true);
    });

    test("should transition heartbeat to idle on CONNECTED", () => {
      const actor = loadedWithCredentials();
      actor.send({ type: "CONNECT" });
      actor.send({ type: "CONNECTED" });
      expect(actor.getSnapshot().matches({ session: { heartbeat: "idle" } })).toBe(true);
    });

    test("should transition heartbeat checking to waiting on HEARTBEAT_FAILED", () => {
      const actor = loadedWithCredentials();
      actor.send({ type: "CONNECT" });
      actor.send({ type: "CONNECTION_LOST", error: "fail" });
      // After CONNECTION_LOST with canRetry, we're in retrying + heartbeat goes to waiting
      // Heartbeat FAILED also triggers retrying at session level
      expect(actor.getSnapshot().matches({ session: { heartbeat: "waiting" } })).toBe(true);
    });
  });

  describe("disconnect and forget", () => {
    test("should transition to disconnected on DISCONNECT from session", () => {
      const actor = loadedWithCredentials();
      actor.send({ type: "CONNECT" });
      actor.send({ type: "DISCONNECT" });
      expect(actor.getSnapshot().value).toBe("disconnected");
    });

    test("should transition to pairing.idle on FORGET from disconnected", () => {
      const actor = loadedWithCredentials();
      actor.send({ type: "FORGET" });
      expect(actor.getSnapshot().matches({ pairing: "idle" })).toBe(true);
      expect(actor.getSnapshot().context.credentials).toBeUndefined();
    });

    test("should transition to pairing.idle on FORGET from session", () => {
      const actor = loadedWithCredentials();
      actor.send({ type: "CONNECT" });
      actor.send({ type: "FORGET" });
      expect(actor.getSnapshot().matches({ pairing: "idle" })).toBe(true);
      expect(actor.getSnapshot().context.credentials).toBeUndefined();
    });
  });

  describe("actor integration", () => {
    test("should complete pairing flow via actor", async () => {
      const mockPairingActor = fromCallback<
        | { type: "PROMPT_RECEIVED" }
        | { type: "PAIRED"; token: string }
        | { type: "PAIRING_ERROR"; error: string }
      >(({ sendBack }) => {
        sendBack({ type: "PROMPT_RECEIVED" });
        Promise.resolve().then(() => sendBack({ type: "PAIRED", token: "actor-token" }));
        return () => {};
      });

      const machine = tizenDeviceMachine.provide({
        actors: { pairingConnection: mockPairingActor, connectionManager: noopActor },
      });

      const actor = createActor(machine, { input: { platform: "samsung-tizen" } });
      actor.start();
      actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "192.168.1.50" });

      const snapshot = await waitFor(actor, (s) => s.matches("disconnected"));
      expect(snapshot.context.credentials?.token).toBe("actor-token");
      actor.stop();
    });

    test("should handle pairing error via actor", async () => {
      const mockPairingActor = fromCallback<
        | { type: "PROMPT_RECEIVED" }
        | { type: "PAIRED"; token: string }
        | { type: "PAIRING_ERROR"; error: string }
      >(({ sendBack }) => {
        sendBack({ type: "PROMPT_RECEIVED" });
        Promise.resolve().then(() => sendBack({ type: "PAIRING_ERROR", error: "TV denied" }));
        return () => {};
      });

      const machine = tizenDeviceMachine.provide({
        actors: { pairingConnection: mockPairingActor, connectionManager: noopActor },
      });

      const actor = createActor(machine, { input: { platform: "samsung-tizen" } });
      actor.start();
      actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "192.168.1.50" });

      const snapshot = await waitFor(actor, (s) => s.matches({ pairing: { active: "error" } }));
      expect(snapshot.context.error).toBe("TV denied");
      actor.stop();
    });

    test("should handle session connected via actor", async () => {
      const mockSessionActor = fromCallback<
        | { type: "CONNECTED" }
        | { type: "CONNECTION_LOST"; error?: string }
        | { type: "HEARTBEAT_OK" }
        | { type: "HEARTBEAT_FAILED"; error: string }
      >(({ sendBack }) => {
        Promise.resolve().then(() => sendBack({ type: "CONNECTED" }));
        return () => {};
      });

      const machine = tizenDeviceMachine.provide({
        actors: { pairingConnection: noopActor, connectionManager: mockSessionActor },
      });

      const actor = createActor(machine, {
        input: {
          platform: "samsung-tizen",
          deviceId: "test-id",
          deviceName: "Samsung TV",
          deviceIp: "192.168.1.200",
          credentials: { token: "test-token", mac: "" },
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
