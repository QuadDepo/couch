import { describe, expect, test } from "bun:test";
import {
  type AnyActorLogic,
  type AnyEventObject,
  type AnyStateMachine,
  createActor,
  fromCallback,
  SimulatedClock,
  type StateValue,
} from "xstate";
import { androidTVDeviceMachine } from "../android-tv/machines/device";
import { androidTvRemoteDeviceMachine } from "../android-tv-remote/machines/device";
import {
  HEARTBEAT_INTERVAL,
  PAIRING_CONNECT_TIMEOUT,
  PAIRING_USER_INPUT_TIMEOUT,
} from "../constants";
import { webosDeviceMachine } from "../lg-webos/machines/device";
import { philipsDeviceMachine } from "../philips-tv/machines/device";
import { tizenDeviceMachine } from "../samsung-tizen/machines/device";

// biome-ignore lint/suspicious/noExplicitAny: noop stub for test isolation
const noopActor = fromCallback(() => () => {}) as any as AnyActorLogic;

/**
 * One fixture per platform describing the knobs the shared `createDeviceMachine`
 * skeleton needs to be exercised: valid load input, the PAIRED payload that
 * satisfies the platform's credentials config, the pairing sub-state entered on
 * PROMPT_RECEIVED, and any events needed to walk from `setup` to
 * `pairing.active.connecting` (android-tv inserts an instruction wizard).
 */
interface DeviceMachineFixture {
  name: string;
  machine: AnyStateMachine;
  platform: string;
  deviceName: string;
  deviceIp: string;
  /** null for credential-less platforms (android-tv ADB): CONNECT is unguarded. */
  credentials: Record<string, unknown> | null;
  /** PAIRED event payload accepted by the platform's credentials config. */
  pairedEvent: AnyEventObject;
  /** Pairing sub-state entered when the pairing actor reports PROMPT_RECEIVED. */
  promptState: string;
  /** State a pairing timeout lands in (webOS keeps it inside pairing.active.error). */
  pairingTimeoutState: StateValue;
  /** State matched immediately after a valid SET_DEVICE_INFO. */
  afterSetupState: StateValue;
  /** Events sent after SET_DEVICE_INFO to reach pairing.active.connecting. */
  toActiveConnecting: AnyEventObject[];
}

const fixtures: DeviceMachineFixture[] = [
  {
    name: "androidTvRemoteDeviceMachine",
    machine: androidTvRemoteDeviceMachine,
    platform: "android-tv-remote",
    deviceName: "Android TV",
    deviceIp: "192.168.1.100",
    credentials: {
      certificate: "test-cert",
      privateKey: "test-key",
      serverCertificate: "test-server-cert",
      lastUpdated: new Date().toISOString(),
    },
    pairedEvent: {
      type: "PAIRED",
      credentials: {
        certificate: "paired-cert",
        privateKey: "paired-key",
        serverCertificate: "paired-server-cert",
        lastUpdated: new Date().toISOString(),
      },
    },
    promptState: "waitingForUser",
    pairingTimeoutState: "error",
    afterSetupState: { pairing: { active: "connecting" } },
    toActiveConnecting: [],
  },
  {
    name: "androidTVDeviceMachine",
    machine: androidTVDeviceMachine,
    platform: "android-tv",
    deviceName: "Living Room TV",
    deviceIp: "192.168.1.100",
    credentials: null,
    pairedEvent: { type: "PAIRED" },
    promptState: "waitingForUser",
    pairingTimeoutState: "error",
    afterSetupState: { pairing: "instructions" },
    toActiveConnecting: [{ type: "CONTINUE_INSTRUCTION" }, { type: "CONTINUE_INSTRUCTION" }],
  },
  {
    name: "tizenDeviceMachine",
    machine: tizenDeviceMachine,
    platform: "samsung-tizen",
    deviceName: "Samsung TV",
    deviceIp: "192.168.1.200",
    credentials: { token: "test-token", mac: "" },
    pairedEvent: { type: "PAIRED", token: "my-token" },
    promptState: "waitingForUser",
    pairingTimeoutState: "error",
    afterSetupState: { pairing: { active: "connecting" } },
    toActiveConnecting: [],
  },
  {
    name: "philipsDeviceMachine",
    machine: philipsDeviceMachine,
    platform: "philips-tv",
    deviceName: "Philips TV",
    deviceIp: "192.168.1.150",
    credentials: { deviceId: "philips-dev-1", authKey: "secret-key" },
    pairedEvent: {
      type: "PAIRED",
      credentials: { deviceId: "philips-dev-1", authKey: "new-auth-key" },
    },
    promptState: "waitingForPin",
    pairingTimeoutState: "error",
    afterSetupState: { pairing: { active: "connecting" } },
    toActiveConnecting: [],
  },
  {
    name: "webosDeviceMachine",
    machine: webosDeviceMachine,
    platform: "lg-webos",
    deviceName: "LG TV",
    deviceIp: "192.168.1.200",
    credentials: { clientKey: "abc123" },
    pairedEvent: { type: "PAIRED", clientKey: "new-key-123" },
    promptState: "waitingForUser",
    pairingTimeoutState: { pairing: { active: "error" } },
    afterSetupState: { pairing: { active: "connecting" } },
    toActiveConnecting: [],
  },
];

for (const fixture of fixtures) {
  const testMachine = fixture.machine.provide({
    actors: { pairingConnection: noopActor, connectionManager: noopActor },
  });
  const hasCredentials = fixture.credentials !== null;

  function loadInput(withCredentials: boolean) {
    return {
      platform: fixture.platform,
      deviceId: "test-id",
      deviceName: fixture.deviceName,
      deviceIp: fixture.deviceIp,
      ...(withCredentials && fixture.credentials ? { credentials: fixture.credentials } : {}),
    };
  }

  function setupActor(clock?: SimulatedClock) {
    const actor = createActor(testMachine, {
      input: { platform: fixture.platform },
      ...(clock ? { clock } : {}),
    });
    actor.start();
    return actor;
  }

  function loadedActor(withCredentials = hasCredentials) {
    const actor = createActor(testMachine, { input: loadInput(withCredentials) });
    actor.start();
    return actor;
  }

  function reachActiveConnecting() {
    const actor = setupActor();
    actor.send({ type: "SET_DEVICE_INFO", name: fixture.deviceName, ip: fixture.deviceIp });
    for (const event of fixture.toActiveConnecting) {
      actor.send(event);
    }
    return actor;
  }

  function reachActiveConnectingWithClock(clock: SimulatedClock) {
    const actor = setupActor(clock);
    actor.send({ type: "SET_DEVICE_INFO", name: fixture.deviceName, ip: fixture.deviceIp });
    for (const event of fixture.toActiveConnecting) {
      actor.send(event);
    }
    return actor;
  }

  describe(fixture.name, () => {
    describe("initialization", () => {
      test("should start in setup when no device info is provided", () => {
        expect(setupActor().getSnapshot().value).toBe("setup");
      });

      test("should start in disconnected when loaded", () => {
        expect(loadedActor().getSnapshot().value).toBe("disconnected");
      });

      if (hasCredentials) {
        test("should start in pairing.idle when loaded without credentials", () => {
          expect(loadedActor(false).getSnapshot().matches({ pairing: "idle" })).toBe(true);
        });
      }
    });

    describe("setup and validation", () => {
      test("should transition into pairing with valid device info", () => {
        const actor = setupActor();
        actor.send({ type: "SET_DEVICE_INFO", name: "My TV", ip: "192.168.1.50" });
        expect(actor.getSnapshot().matches(fixture.afterSetupState)).toBe(true);
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
      test("should transition to the prompt sub-state on PROMPT_RECEIVED", () => {
        const actor = reachActiveConnecting();
        actor.send({ type: "PROMPT_RECEIVED" });
        expect(actor.getSnapshot().matches({ pairing: { active: fixture.promptState } })).toBe(
          true,
        );
        expect(actor.getSnapshot().context.promptReceived).toBe(true);
      });

      test("should transition to disconnected on PAIRED", () => {
        const actor = reachActiveConnecting();
        actor.send(fixture.pairedEvent);
        expect(actor.getSnapshot().value).toBe("disconnected");
      });

      test("should transition to pairing.active.error on PAIRING_ERROR", () => {
        const actor = reachActiveConnecting();
        actor.send({ type: "PAIRING_ERROR", error: "TV denied pairing" });
        expect(actor.getSnapshot().matches({ pairing: { active: "error" } })).toBe(true);
        expect(actor.getSnapshot().context.error).toBe("TV denied pairing");
      });

      test("should allow retry from the pairing error state", () => {
        const actor = reachActiveConnecting();
        actor.send({ type: "PAIRING_ERROR", error: "Failed" });
        actor.send({ type: "START_PAIRING" });
        expect(actor.getSnapshot().matches({ pairing: { active: "connecting" } })).toBe(true);
        expect(actor.getSnapshot().context.error).toBeUndefined();
      });

      test("should reset to setup on RESET_TO_SETUP", () => {
        const actor = reachActiveConnecting();
        actor.send({ type: "RESET_TO_SETUP" });
        expect(actor.getSnapshot().value).toBe("setup");
        expect(actor.getSnapshot().context.deviceId).toBeNull();
        expect(actor.getSnapshot().context.deviceName).toBe("");
      });
    });

    describe("pairing timeouts", () => {
      test("should time out from connecting to error state", () => {
        const clock = new SimulatedClock();
        const actor = reachActiveConnectingWithClock(clock);
        expect(actor.getSnapshot().matches({ pairing: { active: "connecting" } })).toBe(true);

        clock.increment(PAIRING_CONNECT_TIMEOUT);
        expect(actor.getSnapshot().matches(fixture.pairingTimeoutState)).toBe(true);
        expect(actor.getSnapshot().context.error).toContain("Pairing timed out");
      });

      test("should time out from the prompt sub-state to error state", () => {
        const clock = new SimulatedClock();
        const actor = reachActiveConnectingWithClock(clock);
        actor.send({ type: "PROMPT_RECEIVED" });
        expect(actor.getSnapshot().matches({ pairing: { active: fixture.promptState } })).toBe(
          true,
        );

        clock.increment(PAIRING_USER_INPUT_TIMEOUT);
        expect(actor.getSnapshot().matches(fixture.pairingTimeoutState)).toBe(true);
        expect(actor.getSnapshot().context.error).toContain("Pairing timed out");
      });
    });

    if (hasCredentials) {
      describe("connect guard", () => {
        test("should not start session on CONNECT without credentials", () => {
          const actor = loadedActor(false);
          actor.send({ type: "CONNECT" });
          expect(actor.getSnapshot().matches({ session: {} })).toBe(false);
          expect(actor.getSnapshot().matches({ pairing: "idle" })).toBe(true);
        });

        test("should transition to pairing.active.connecting on START_PAIRING from idle", () => {
          const actor = loadedActor(false);
          expect(actor.getSnapshot().matches({ pairing: "idle" })).toBe(true);
          actor.send({ type: "START_PAIRING" });
          expect(actor.getSnapshot().matches({ pairing: { active: "connecting" } })).toBe(true);
        });
      });
    }

    describe("session and connection", () => {
      test("should transition to session on CONNECT from disconnected", () => {
        const actor = loadedActor();
        actor.send({ type: "CONNECT" });
        expect(actor.getSnapshot().matches({ session: {} })).toBe(true);
      });

      test("should transition to session.connection.connected on CONNECTED", () => {
        const actor = loadedActor();
        actor.send({ type: "CONNECT" });
        actor.send({ type: "CONNECTED" });
        expect(
          actor.getSnapshot().matches({ session: { connection: "connected", heartbeat: "idle" } }),
        ).toBe(true);
      });

      test("should transition to retrying on CONNECTION_LOST when retries remain", () => {
        const actor = loadedActor();
        actor.send({ type: "CONNECT" });
        actor.send({ type: "CONNECTION_LOST", error: "Timeout" });
        expect(actor.getSnapshot().matches({ session: { connection: "retrying" } })).toBe(true);
        expect(actor.getSnapshot().context.retryCount).toBe(1);
        expect(actor.getSnapshot().context.error).toBe("Timeout");
      });

      test("should transition to error when max retries exceeded on CONNECTION_LOST", () => {
        const actor = loadedActor();
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
        const actor = loadedActor();
        actor.send({ type: "CONNECT" });
        actor.send({ type: "CONNECTED" });
        expect(actor.getSnapshot().context.retryCount).toBe(0);
        expect(actor.getSnapshot().context.error).toBeUndefined();
      });

      test("should forward SEND_KEY to the session while connected", () => {
        const actor = loadedActor();
        actor.send({ type: "CONNECT" });
        actor.send({ type: "CONNECTED" });
        actor.send({ type: "SEND_KEY", key: "UP" });
        expect(actor.getSnapshot().matches({ session: { connection: "connected" } })).toBe(true);
      });

      test("should forward SEND_TEXT to the session while connected", () => {
        const actor = loadedActor();
        actor.send({ type: "CONNECT" });
        actor.send({ type: "CONNECTED" });
        actor.send({ type: "SEND_TEXT", text: "test" });
        expect(actor.getSnapshot().matches({ session: { connection: "connected" } })).toBe(true);
      });
    });

    describe("heartbeat", () => {
      test("should start heartbeat in waiting state", () => {
        const actor = loadedActor();
        actor.send({ type: "CONNECT" });
        expect(actor.getSnapshot().matches({ session: { heartbeat: "waiting" } })).toBe(true);
      });

      test("should transition heartbeat to idle on CONNECTED", () => {
        const actor = loadedActor();
        actor.send({ type: "CONNECT" });
        actor.send({ type: "CONNECTED" });
        expect(actor.getSnapshot().matches({ session: { heartbeat: "idle" } })).toBe(true);
      });

      test("should transition to retrying on HEARTBEAT_FAILED when retries remain", () => {
        const actor = loadedActor();
        actor.send({ type: "CONNECT" });
        actor.send({ type: "CONNECTED" });
        actor.send({ type: "HEARTBEAT_FAILED", error: "Heartbeat timeout" });
        expect(actor.getSnapshot().matches({ session: { connection: "retrying" } })).toBe(true);
        expect(actor.getSnapshot().context.error).toBe("Heartbeat timeout");
      });

      test("should return heartbeat to waiting on HEARTBEAT_FAILED from checking", () => {
        const clock = new SimulatedClock();
        const actor = createActor(testMachine, { input: loadInput(hasCredentials), clock });
        actor.start();
        actor.send({ type: "CONNECT" });
        actor.send({ type: "CONNECTED" });

        clock.increment(HEARTBEAT_INTERVAL);
        expect(actor.getSnapshot().matches({ session: { heartbeat: "checking" } })).toBe(true);

        actor.send({ type: "HEARTBEAT_FAILED", error: "no heartbeat response" });
        expect(actor.getSnapshot().matches({ session: { heartbeat: "waiting" } })).toBe(true);
      });
    });

    describe("disconnect and forget", () => {
      test("should transition to disconnected on DISCONNECT from session", () => {
        const actor = loadedActor();
        actor.send({ type: "CONNECT" });
        actor.send({ type: "DISCONNECT" });
        expect(actor.getSnapshot().value).toBe("disconnected");
      });

      test("should transition to pairing.idle on FORGET from disconnected", () => {
        const actor = loadedActor();
        actor.send({ type: "FORGET" });
        expect(actor.getSnapshot().matches({ pairing: "idle" })).toBe(true);
        if (hasCredentials) {
          expect(actor.getSnapshot().context.credentials).toBeUndefined();
        }
      });

      test("should transition to pairing.idle on FORGET from session", () => {
        const actor = loadedActor();
        actor.send({ type: "CONNECT" });
        actor.send({ type: "FORGET" });
        expect(actor.getSnapshot().matches({ pairing: "idle" })).toBe(true);
        if (hasCredentials) {
          expect(actor.getSnapshot().context.credentials).toBeUndefined();
        }
      });

      test("should reset retry count on FORGET", () => {
        const actor = loadedActor();
        actor.send({ type: "CONNECT" });
        actor.send({ type: "CONNECTION_LOST", error: "Test" });
        expect(actor.getSnapshot().context.retryCount).toBe(1);
        actor.send({ type: "FORGET" });
        expect(actor.getSnapshot().context.retryCount).toBe(0);
      });
    });

    describe("error recovery", () => {
      function reachErrorState() {
        const actor = loadedActor();
        actor.send({ type: "CONNECT" });
        for (let i = 0; i < 5; i++) {
          actor.send({ type: "CONNECTION_LOST", error: "Timeout" });
          if (i < 4) {
            actor.send({ type: "CONNECTED" });
            actor.send({ type: "CONNECTION_LOST", error: "Timeout" });
          }
        }
        expect(actor.getSnapshot().value).toBe("error");
        return actor;
      }

      test("should allow CONNECT from error state", () => {
        const actor = reachErrorState();
        actor.send({ type: "CONNECT" });
        expect(actor.getSnapshot().matches({ session: {} })).toBe(true);
        expect(actor.getSnapshot().context.retryCount).toBe(0);
      });

      test("should allow DISCONNECT from error state", () => {
        const actor = reachErrorState();
        actor.send({ type: "DISCONNECT" });
        expect(actor.getSnapshot().value).toBe("disconnected");
      });
    });
  });
}
