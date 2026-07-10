import { describe, expect, test } from "bun:test";
import { createActor, fromCallback, SimulatedClock, waitFor } from "xstate";
import { PAIRING_CONNECT_TIMEOUT, PAIRING_USER_INPUT_TIMEOUT } from "../../constants";
import type { PairingEvent, PairingInput } from "./actors/pairing";
import type { SessionEvent, SessionInput } from "./actors/sessionActorTypes";
import { webosDeviceMachine } from "./device";
import {
  loadedWithCredentials,
  loadedWithoutCredentials,
  noopActor,
  testMachine,
} from "./deviceTestSupport";

describe("webosDeviceMachine sessions", () => {
  test("transitions to session on CONNECT", () => {
    const actor = loadedWithCredentials();
    actor.send({ type: "CONNECT" });
    expect(actor.getSnapshot().matches({ session: {} })).toBe(true);
  });

  test("transitions to the connected session state", () => {
    const actor = loadedWithCredentials();
    actor.send({ type: "CONNECT" });
    actor.send({ type: "CONNECTED" });
    expect(
      actor.getSnapshot().matches({ session: { connection: "connected", heartbeat: "idle" } }),
    ).toBe(true);
  });

  test("increments retry after connection loss", () => {
    const actor = loadedWithCredentials();
    actor.send({ type: "CONNECT" });
    actor.send({ type: "CONNECTION_LOST", error: "Timeout" });
    expect(actor.getSnapshot().matches({ session: { connection: "retrying" } })).toBe(true);
    expect(actor.getSnapshot().context.retryCount).toBe(1);
  });

  test("transitions to error when retries are exhausted", () => {
    const actor = loadedWithCredentials();
    actor.send({ type: "CONNECT" });
    for (let index = 0; index < 5; index += 1) {
      actor.send({ type: "CONNECTION_LOST", error: "Timeout" });
      if (index < 4) {
        actor.send({ type: "CONNECTED" });
        actor.send({ type: "CONNECTION_LOST", error: "Timeout" });
      }
    }
    expect(actor.getSnapshot().value).toBe("error");
    expect(actor.getSnapshot().context.error).toBe("Max retries exceeded");
  });

  test("times out while pairing connects", () => {
    const clock = new SimulatedClock();
    const actor = createActor(testMachine, { input: { platform: "lg-webos" }, clock }).start();
    actor.send({ type: "SET_DEVICE_INFO", name: "LG TV", ip: "192.168.1.200" });
    clock.increment(PAIRING_CONNECT_TIMEOUT);
    expect(actor.getSnapshot().matches({ pairing: { active: "error" } })).toBe(true);
    expect(actor.getSnapshot().context.error).toContain("Pairing timed out");
  });

  test("times out while waiting for pairing confirmation", () => {
    const clock = new SimulatedClock();
    const actor = createActor(testMachine, { input: { platform: "lg-webos" }, clock }).start();
    actor.send({ type: "SET_DEVICE_INFO", name: "LG TV", ip: "192.168.1.200" });
    actor.send({ type: "PROMPT_RECEIVED" });
    clock.increment(PAIRING_USER_INPUT_TIMEOUT);
    expect(actor.getSnapshot().matches({ pairing: { active: "error" } })).toBe(true);
    expect(actor.getSnapshot().context.error).toContain("Pairing timed out");
  });

  test("does not connect without credentials", () => {
    const actor = loadedWithoutCredentials();
    actor.send({ type: "CONNECT" });
    expect(actor.getSnapshot().matches({ session: {} })).toBe(false);
    expect(actor.getSnapshot().matches({ pairing: "idle" })).toBe(true);
  });

  test("clears forgotten credentials", () => {
    const actor = loadedWithCredentials();
    actor.send({ type: "FORGET" });
    expect(actor.getSnapshot().matches({ pairing: "idle" })).toBe(true);
    expect(actor.getSnapshot().context.credentials).toBeUndefined();
  });

  test("completes pairing through the pairing actor", async () => {
    const pairingActor = fromCallback<PairingEvent, PairingInput>(({ sendBack }) => {
      sendBack({ type: "PROMPT_RECEIVED" });
      Promise.resolve().then(() => sendBack({ type: "PAIRED", clientKey: "paired-key" }));
      return () => {};
    });
    const machine = webosDeviceMachine.provide({
      actors: { pairingConnection: pairingActor, connectionManager: noopActor },
    });
    const actor = createActor(machine, { input: { platform: "lg-webos" } }).start();
    actor.send({ type: "SET_DEVICE_INFO", name: "LG TV", ip: "192.168.1.200" });
    const snapshot = await waitFor(actor, (state) => state.matches("disconnected"));
    expect(snapshot.context.credentials?.clientKey).toBe("paired-key");
    actor.stop();
  });

  test("reports pairing actor errors", async () => {
    const pairingActor = fromCallback<PairingEvent, PairingInput>(({ sendBack }) => {
      Promise.resolve().then(() => sendBack({ type: "PAIRING_ERROR", error: "TV rejected" }));
      return () => {};
    });
    const machine = webosDeviceMachine.provide({
      actors: { pairingConnection: pairingActor, connectionManager: noopActor },
    });
    const actor = createActor(machine, { input: { platform: "lg-webos" } }).start();
    actor.send({ type: "SET_DEVICE_INFO", name: "LG TV", ip: "192.168.1.200" });
    const snapshot = await waitFor(actor, (state) =>
      state.matches({ pairing: { active: "error" } }),
    );
    expect(snapshot.context.error).toBe("TV rejected");
    actor.stop();
  });

  test("reaches connected state through the session actor", async () => {
    const sessionActor = fromCallback<SessionEvent, SessionInput>(({ sendBack }) => {
      Promise.resolve().then(() => sendBack({ type: "CONNECTED" }));
      return () => {};
    });
    const machine = webosDeviceMachine.provide({
      actors: { pairingConnection: noopActor, connectionManager: sessionActor },
    });
    const actor = createActor(machine, {
      input: {
        platform: "lg-webos",
        deviceId: "test-id",
        deviceName: "LG TV",
        deviceIp: "192.168.1.200",
        credentials: { clientKey: "abc123" },
      },
    }).start();
    actor.send({ type: "CONNECT" });
    const snapshot = await waitFor(actor, (state) =>
      state.matches({ session: { connection: "connected" } }),
    );
    expect(snapshot.context.retryCount).toBe(0);
    actor.stop();
  });
});
