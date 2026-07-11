import { describe, expect, test } from "bun:test";
import { createActor, fromCallback, waitFor } from "xstate";
import type { PairingEvent, PairingInput } from "./actors/pairing";
import { webosDeviceMachine } from "./device";
import { noopActor, setupActor } from "./deviceTestSupport";

// Shared skeleton behavior (init, setup/validation, pairing, session, heartbeat,
// forget, error recovery, timeouts) is covered by ../../shared/machine.test.ts.
// This suite covers only the webOS clientKey credential and SSL-retry recovery.

describe("webosDeviceMachine SSL retry", () => {
  test("should store the clientKey credential on PAIRED", () => {
    const actor = setupActor();
    actor.send({ type: "SET_DEVICE_INFO", name: "LG TV", ip: "192.168.1.200" });
    actor.send({ type: "PAIRED", clientKey: "new-key-123" });
    expect(actor.getSnapshot().value).toBe("disconnected");
    expect(actor.getSnapshot().context.credentials?.clientKey).toBe("new-key-123");
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
