import { type Actor, sendTo } from "xstate";
import {
  createDeviceMachine,
  type DeviceLoadInput,
  type PlatformInput,
} from "../../shared/machine";
import type { PhilipsCredentials } from "../credentials";
import { validatePhilipsCredentials } from "../credentials";
import { pairingActor } from "./actors/pairing";
import { sessionActor } from "./actors/session";

export type PhilipsSetupInput = PlatformInput<"philips-tv">;

export type PhilipsLoadInput = DeviceLoadInput<"philips-tv">;

export type PhilipsMachineInput = PhilipsSetupInput | PhilipsLoadInput;

type PhilipsPlatformEvent =
  | { type: "SUBMIT_PIN"; pin: string }
  | { type: "PAIRED"; credentials: PhilipsCredentials };

export const philipsDeviceMachine = createDeviceMachine<
  PhilipsMachineInput,
  PhilipsCredentials,
  PhilipsPlatformEvent,
  Record<never, never>,
  typeof pairingActor,
  typeof sessionActor
>({
  id: "philipsDevice",
  logCategory: "Philips",
  credentials: {
    validate: validatePhilipsCredentials,
    fromPairedEvent: (event) => event.credentials,
    hasCredentials: (credentials) => !!credentials?.deviceId && !!credentials?.authKey,
  },
  pairing: {
    logic: pairingActor,
    input: (context) => ({ ip: context.deviceIp, deviceName: context.deviceName }),
    invokeId: "pairingConnection",
    promptTarget: "waitingForPin",
    states: ({ userInputTimeout }) => ({
      waitingForPin: {
        on: {
          SUBMIT_PIN: {
            target: "confirming",
            actions: sendTo("pairingConnection", ({ event }) => event),
          },
        },
        after: { pairingUserInputTimeout: userInputTimeout },
      },
      confirming: {
        after: { pairingUserInputTimeout: userInputTimeout },
      },
    }),
  },
  session: {
    logic: sessionActor,
    input: (context) => ({
      ip: context.deviceIp,
      credentials: context.credentials as PhilipsCredentials,
      deviceName: context.deviceName,
    }),
  },
});

export type PhilipsDeviceMachine = typeof philipsDeviceMachine;
export type PhilipsDeviceMachineActor = Actor<PhilipsDeviceMachine>;
