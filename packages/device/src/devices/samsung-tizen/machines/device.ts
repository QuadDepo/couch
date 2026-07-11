import type { Actor } from "xstate";
import {
  createDeviceMachine,
  type DeviceLoadInput,
  type PlatformInput,
} from "../../shared/machine";
import type { TizenCredentials } from "../credentials";
import { createCredentials, validateTizenCredentials } from "../credentials";
import { pairingActor } from "./actors/pairing";
import { sessionActor } from "./actors/session";

export type TizenSetupInput = PlatformInput<"samsung-tizen">;

export type TizenLoadInput = DeviceLoadInput<"samsung-tizen">;

export type TizenMachineInput = TizenSetupInput | TizenLoadInput;

type TizenPlatformEvent = { type: "PAIRED"; token: string };

export const tizenDeviceMachine = createDeviceMachine<
  TizenMachineInput,
  TizenCredentials,
  TizenPlatformEvent,
  Record<never, never>,
  typeof pairingActor,
  typeof sessionActor
>({
  id: "tizenDevice",
  logCategory: "Tizen",
  credentials: {
    validate: validateTizenCredentials,
    fromPairedEvent: (event) => createCredentials({ token: event.token }),
    hasCredentials: (credentials) => !!credentials?.token,
  },
  pairing: {
    logic: pairingActor,
    input: (context) => ({ ip: context.deviceIp }),
    promptTarget: "waitingForUser",
    states: ({ userInputTimeout }) => ({
      waitingForUser: {
        after: { pairingUserInputTimeout: userInputTimeout },
      },
    }),
  },
  session: {
    logic: sessionActor,
    input: (context) => ({
      ip: context.deviceIp,
      credentials: context.credentials as TizenCredentials,
      deviceName: context.deviceName,
    }),
  },
});

export type TizenDeviceMachine = typeof tizenDeviceMachine;
export type TizenDeviceMachineActor = Actor<TizenDeviceMachine>;
