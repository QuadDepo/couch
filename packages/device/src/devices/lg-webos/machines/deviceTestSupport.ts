import { createActor, fromCallback } from "xstate";
import { webosDeviceMachine } from "./device";

// biome-ignore lint/suspicious/noExplicitAny: noop stub for test isolation
export const noopActor = fromCallback(() => () => {}) as any;

export const testMachine = webosDeviceMachine.provide({
  actors: {
    pairingConnection: noopActor,
    connectionManager: noopActor,
  },
});

export function setupActor() {
  const actor = createActor(testMachine, { input: { platform: "lg-webos" } });
  actor.start();
  return actor;
}

export function loadedWithCredentials() {
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

export function loadedWithoutCredentials() {
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
