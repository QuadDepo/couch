import { describe, expect, test } from "bun:test";
import { createActor, fromCallback } from "xstate";
import type { AndroidTvRemoteCredentials } from "../credentials";
import { androidTvRemoteDeviceMachine } from "./device";

// biome-ignore lint/suspicious/noExplicitAny: noop stub for test isolation
const noopActor = fromCallback(() => () => {}) as any;

const testMachine = androidTvRemoteDeviceMachine.provide({
  actors: {
    pairingConnection: noopActor,
    connectionManager: noopActor,
  },
});

function setupActor(input?: Parameters<typeof createActor<typeof testMachine>>[1]) {
  const actor = createActor(testMachine, input ?? { input: { platform: "android-tv-remote" } });
  actor.start();
  return actor;
}

function loadedWithCredentials() {
  const credentials: AndroidTvRemoteCredentials = {
    certificate: "test-cert",
    privateKey: "test-key",
    serverCertificate: "test-server-cert",
    lastUpdated: new Date().toISOString(),
  };

  return setupActor({
    input: {
      platform: "android-tv-remote",
      deviceId: "test-id",
      deviceName: "Android TV",
      deviceIp: "192.168.1.100",
      credentials,
    },
  });
}

function loadedWithoutCredentials() {
  return setupActor({
    input: {
      platform: "android-tv-remote",
      deviceId: "test-id",
      deviceName: "Android TV",
      deviceIp: "192.168.1.100",
    },
  });
}

describe("androidTvRemoteDeviceMachine", () => {
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
      actor.send({ type: "SET_DEVICE_INFO", name: "My Android TV", ip: "192.168.1.50" });
      expect(actor.getSnapshot().matches({ pairing: { active: "connecting" } })).toBe(true);
      expect(actor.getSnapshot().context.deviceName).toBe("My Android TV");
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

    test("should store pairing code when SET_PAIRING_CODE is sent", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "192.168.1.50" });
      actor.send({ type: "PROMPT_RECEIVED" });
      actor.send({ type: "SET_PAIRING_CODE", code: "ABC123" });
      expect(actor.getSnapshot().context.pairingCode).toBe("ABC123");
    });

    test("should transition to verifying on SUBMIT_CODE", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "192.168.1.50" });
      actor.send({ type: "PROMPT_RECEIVED" });
      actor.send({ type: "SET_PAIRING_CODE", code: "ABC123" });
      actor.send({ type: "SUBMIT_CODE", code: "ABC123" });
      expect(actor.getSnapshot().matches({ pairing: { active: "verifying" } })).toBe(true);
    });

    test("should transition to disconnected on PAIRED and store credentials", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "192.168.1.50" });

      const credentials: AndroidTvRemoteCredentials = {
        certificate: "paired-cert",
        privateKey: "paired-key",
        serverCertificate: "paired-server-cert",
        lastUpdated: new Date().toISOString(),
      };

      actor.send({ type: "PAIRED", credentials });
      expect(actor.getSnapshot().value).toBe("disconnected");
      expect(actor.getSnapshot().context.credentials?.certificate).toBe("paired-cert");
      expect(actor.getSnapshot().context.credentials?.privateKey).toBe("paired-key");
      expect(actor.getSnapshot().context.credentials?.serverCertificate).toBe("paired-server-cert");
    });

    test("should transition to pairing.active.error on PAIRING_ERROR", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "192.168.1.50" });
      actor.send({ type: "PAIRING_ERROR", error: "TV denied pairing" });
      expect(actor.getSnapshot().matches({ pairing: { active: "error" } })).toBe(true);
      expect(actor.getSnapshot().context.error).toBe("TV denied pairing");
    });

    test("should allow retry from error state", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "192.168.1.50" });
      actor.send({ type: "PAIRING_ERROR", error: "Failed" });
      actor.send({ type: "START_PAIRING" });
      expect(actor.getSnapshot().matches({ pairing: { active: "connecting" } })).toBe(true);
      expect(actor.getSnapshot().context.error).toBeUndefined();
    });

    test("should reset to setup on RESET_TO_SETUP", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "192.168.1.50" });
      actor.send({ type: "RESET_TO_SETUP" });
      expect(actor.getSnapshot().value).toBe("setup");
      expect(actor.getSnapshot().context.deviceId).toBeNull();
      expect(actor.getSnapshot().context.deviceName).toBe("");
      expect(actor.getSnapshot().context.pairingCode).toBe("");
    });

    test("should clear pairing code when transitioning to error", () => {
      const actor = setupActor();
      actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "192.168.1.50" });
      actor.send({ type: "PROMPT_RECEIVED" });
      actor.send({ type: "SET_PAIRING_CODE", code: "ABC123" });
      actor.send({ type: "PAIRING_ERROR", error: "Failed" });
      actor.send({ type: "START_PAIRING" });
      expect(actor.getSnapshot().context.pairingCode).toBe("");
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

      // Trigger 5 CONNECTION_LOST events to exceed maxRetries
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

    test("should accept SEND_KEY event in connected state", () => {
      const actor = loadedWithCredentials();
      actor.send({ type: "CONNECT" });
      actor.send({ type: "CONNECTED" });
      // Should not throw or change state
      actor.send({ type: "SEND_KEY", key: "UP" });
      expect(actor.getSnapshot().matches({ session: { connection: "connected" } })).toBe(true);
    });

    test("should accept SEND_TEXT event in connected state", () => {
      const actor = loadedWithCredentials();
      actor.send({ type: "CONNECT" });
      actor.send({ type: "CONNECTED" });
      // Should not throw or change state
      actor.send({ type: "SEND_TEXT", text: "test" });
      expect(actor.getSnapshot().matches({ session: { connection: "connected" } })).toBe(true);
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

    test("should transition to retrying on HEARTBEAT_FAILED when retries remain", () => {
      const actor = loadedWithCredentials();
      actor.send({ type: "CONNECT" });
      actor.send({ type: "CONNECTED" });
      actor.send({ type: "HEARTBEAT_FAILED", error: "Heartbeat timeout" });
      expect(actor.getSnapshot().matches({ session: { connection: "retrying" } })).toBe(true);
      expect(actor.getSnapshot().context.error).toBe("Heartbeat timeout");
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

    test("should reset retry count on FORGET", () => {
      const actor = loadedWithCredentials();
      actor.send({ type: "CONNECT" });
      actor.send({ type: "CONNECTION_LOST", error: "Test" });
      expect(actor.getSnapshot().context.retryCount).toBe(1);
      actor.send({ type: "FORGET" });
      expect(actor.getSnapshot().context.retryCount).toBe(0);
    });
  });

  describe("error recovery", () => {
    test("should allow CONNECT from error state", () => {
      const actor = loadedWithCredentials();
      actor.send({ type: "CONNECT" });
      // Exhaust retries
      for (let i = 0; i < 6; i++) {
        actor.send({ type: "CONNECTION_LOST", error: "Timeout" });
      }
      expect(actor.getSnapshot().value).toBe("error");

      // Should be able to reconnect from error state
      actor.send({ type: "CONNECT" });
      expect(actor.getSnapshot().matches({ session: {} })).toBe(true);
      expect(actor.getSnapshot().context.retryCount).toBe(0);
    });

    test("should allow DISCONNECT from error state", () => {
      const actor = loadedWithCredentials();
      actor.send({ type: "CONNECT" });
      // Cause error
      for (let i = 0; i < 6; i++) {
        actor.send({ type: "CONNECTION_LOST", error: "Timeout" });
      }

      actor.send({ type: "DISCONNECT" });
      expect(actor.getSnapshot().value).toBe("disconnected");
    });
  });
});
