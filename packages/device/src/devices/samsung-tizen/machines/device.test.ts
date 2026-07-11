import { describe, expect, test } from "bun:test";
import { createActor, fromCallback, waitFor } from "xstate";
import type { PairingEvent, PairingInput } from "./actors/pairing";
import type { SessionEvent, SessionInput } from "./actors/session";
import { tizenDeviceMachine } from "./device";

// Shared skeleton behavior (init, setup/validation, pairing, session, heartbeat,
// forget, error recovery, timeouts) is covered by ../../shared/machine.test.ts.
// This suite covers only the Tizen token credential and actor integration.

// biome-ignore lint/suspicious/noExplicitAny: noop stub for test isolation
const noopActor = fromCallback(() => () => {}) as any;

const testMachine = tizenDeviceMachine.provide({
  actors: {
    pairingConnection: noopActor,
    connectionManager: noopActor,
  },
});

function setupActor() {
  const actor = createActor(testMachine, { input: { platform: "samsung-tizen" } });
  actor.start();
  return actor;
}

describe("tizenDeviceMachine", () => {
  test("should store the token credential on PAIRED", () => {
    const actor = setupActor();
    actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "192.168.1.50" });
    actor.send({ type: "PAIRED", token: "my-token" });
    expect(actor.getSnapshot().value).toBe("disconnected");
    expect(actor.getSnapshot().context.credentials?.token).toBe("my-token");
  });

  describe("actor integration", () => {
    test("should complete pairing flow via actor", async () => {
      const mockPairingActor = fromCallback<PairingEvent, PairingInput>(({ sendBack }) => {
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
      const mockPairingActor = fromCallback<PairingEvent, PairingInput>(({ sendBack }) => {
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
      const mockSessionActor = fromCallback<SessionEvent, SessionInput>(({ sendBack }) => {
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
