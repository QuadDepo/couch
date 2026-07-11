import { describe, expect, test } from "bun:test";
import { createActor, fromCallback, SimulatedClock, waitFor } from "xstate";
import { PAIRING_USER_INPUT_TIMEOUT } from "../../constants";
import type { PhilipsCredentials } from "../credentials";
import type { PairingEvent, PairingInput } from "./actors/pairing";
import type { SessionEvent, SessionInput } from "./actors/session";
import { philipsDeviceMachine } from "./device";

// Shared skeleton behavior (init, setup/validation, pairing, session, heartbeat,
// forget, error recovery, timeouts) is covered by ../../shared/machine.test.ts.
// This suite covers only the Philips PIN confirmation flow and actor integration.

// biome-ignore lint/suspicious/noExplicitAny: noop stub for test isolation
const noopActor = fromCallback(() => () => {}) as any;

const testMachine = philipsDeviceMachine.provide({
  actors: {
    pairingConnection: noopActor,
    connectionManager: noopActor,
  },
});

function inWaitingForPin() {
  const actor = createActor(testMachine, { input: { platform: "philips-tv" } });
  actor.start();
  actor.send({ type: "SET_DEVICE_INFO", name: "Philips TV", ip: "192.168.1.150" });
  actor.send({ type: "PROMPT_RECEIVED" });
  return actor;
}

describe("philipsDeviceMachine PIN flow", () => {
  test("should transition to confirming on SUBMIT_PIN", () => {
    const actor = inWaitingForPin();
    actor.send({ type: "SUBMIT_PIN", pin: "1234" });
    expect(actor.getSnapshot().matches({ pairing: { active: "confirming" } })).toBe(true);
  });

  test("should store credentials on PAIRED", () => {
    const actor = inWaitingForPin();
    actor.send({ type: "SUBMIT_PIN", pin: "1234" });
    actor.send({
      type: "PAIRED",
      credentials: { deviceId: "philips-dev-1", authKey: "new-auth-key" },
    });
    expect(actor.getSnapshot().value).toBe("disconnected");
    expect(actor.getSnapshot().context.credentials?.authKey).toBe("new-auth-key");
    expect(actor.getSnapshot().context.credentials?.deviceId).toBe("philips-dev-1");
  });

  test("should time out from confirming to error state", () => {
    const clock = new SimulatedClock();
    const actor = createActor(testMachine, { input: { platform: "philips-tv" }, clock });
    actor.start();
    actor.send({ type: "SET_DEVICE_INFO", name: "Philips TV", ip: "192.168.1.150" });
    actor.send({ type: "PROMPT_RECEIVED" });
    actor.send({ type: "SUBMIT_PIN", pin: "1234" });
    expect(actor.getSnapshot().matches({ pairing: { active: "confirming" } })).toBe(true);

    clock.increment(PAIRING_USER_INPUT_TIMEOUT);
    expect(actor.getSnapshot().value).toBe("error");
    expect(actor.getSnapshot().context.error).toContain("Pairing timed out");
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
