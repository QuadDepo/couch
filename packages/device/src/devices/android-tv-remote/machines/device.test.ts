import { describe, expect, test } from "bun:test";
import { createActor, fromCallback, SimulatedClock } from "xstate";
import { PAIRING_USER_INPUT_TIMEOUT } from "../../constants";
import type { AndroidTvRemoteCredentials } from "../credentials";
import { androidTvRemoteDeviceMachine } from "./device";

// Shared skeleton behavior (init, setup/validation, session, heartbeat, forget,
// error recovery, pairing timeouts) is covered by ../../shared/machine.test.ts.
// This suite covers only the android-tv-remote pairing-code flow.

// biome-ignore lint/suspicious/noExplicitAny: noop stub for test isolation
const noopActor = fromCallback(() => () => {}) as any;

const testMachine = androidTvRemoteDeviceMachine.provide({
  actors: {
    pairingConnection: noopActor,
    connectionManager: noopActor,
  },
});

function setupActor() {
  const actor = createActor(testMachine, { input: { platform: "android-tv-remote" } });
  actor.start();
  return actor;
}

function inWaitingForUser() {
  const actor = setupActor();
  actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "192.168.1.50" });
  actor.send({ type: "PROMPT_RECEIVED" });
  return actor;
}

describe("androidTvRemoteDeviceMachine pairing-code flow", () => {
  test("should store pairing code when SET_PAIRING_CODE is sent", () => {
    const actor = inWaitingForUser();
    actor.send({ type: "SET_PAIRING_CODE", code: "ABC123" });
    expect(actor.getSnapshot().context.pairingCode).toBe("ABC123");
  });

  test("should transition to verifying on SUBMIT_CODE", () => {
    const actor = inWaitingForUser();
    actor.send({ type: "SET_PAIRING_CODE", code: "ABC123" });
    actor.send({ type: "SUBMIT_CODE", code: "ABC123" });
    expect(actor.getSnapshot().matches({ pairing: { active: "verifying" } })).toBe(true);
  });

  test("should store credentials on PAIRED", () => {
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

  test("should time out from verifying to error state", () => {
    const clock = new SimulatedClock();
    const actor = createActor(testMachine, { input: { platform: "android-tv-remote" }, clock });
    actor.start();
    actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "192.168.1.50" });
    actor.send({ type: "PROMPT_RECEIVED" });
    actor.send({ type: "SUBMIT_CODE", code: "ABC123" });
    expect(actor.getSnapshot().matches({ pairing: { active: "verifying" } })).toBe(true);

    clock.increment(PAIRING_USER_INPUT_TIMEOUT);
    expect(actor.getSnapshot().value).toBe("error");
    expect(actor.getSnapshot().context.error).toContain("Pairing timed out");
  });

  test("should clear pairing code when retrying after an error", () => {
    const actor = inWaitingForUser();
    actor.send({ type: "SET_PAIRING_CODE", code: "ABC123" });
    actor.send({ type: "PAIRING_ERROR", error: "Failed" });
    actor.send({ type: "START_PAIRING" });
    expect(actor.getSnapshot().context.pairingCode).toBe("");
  });

  test("should clear pairing code on RESET_TO_SETUP", () => {
    const actor = inWaitingForUser();
    actor.send({ type: "SET_PAIRING_CODE", code: "ABC123" });
    actor.send({ type: "RESET_TO_SETUP" });
    expect(actor.getSnapshot().value).toBe("setup");
    expect(actor.getSnapshot().context.pairingCode).toBe("");
  });
});
