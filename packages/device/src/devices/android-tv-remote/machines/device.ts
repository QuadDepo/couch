import type { Actor, SnapshotFrom } from "xstate";
import { assign, sendTo } from "xstate";
import {
  createDeviceMachine,
  type DeviceLoadInput,
  type PlatformInput,
} from "../../shared/machine";
import type { AndroidTvRemoteCredentials } from "../credentials";
import { createCredentials, validateAndroidTvRemoteCredentials } from "../credentials";
import { pairingActor } from "./actors/pairing";
import { sessionActor } from "./actors/session";

export type AndroidTvRemoteSetupInput = PlatformInput<"android-tv-remote">;

export type AndroidTvRemoteLoadInput = DeviceLoadInput<"android-tv-remote">;

export type AndroidTvRemoteMachineInput = AndroidTvRemoteSetupInput | AndroidTvRemoteLoadInput;

type AndroidTvRemotePlatformEvent =
  | { type: "PAIRED"; credentials: AndroidTvRemoteCredentials }
  | { type: "SUBMIT_CODE"; code: string }
  | { type: "SET_PAIRING_CODE"; code: string };

type AndroidTvRemoteExtraContext = { pairingCode: string };

export const androidTvRemoteDeviceMachine = createDeviceMachine<
  AndroidTvRemoteMachineInput,
  AndroidTvRemoteCredentials,
  AndroidTvRemotePlatformEvent,
  AndroidTvRemoteExtraContext,
  typeof pairingActor,
  typeof sessionActor
>({
  id: "androidTvRemoteDevice",
  logCategory: "AndroidTVRemote",
  credentials: {
    validate: validateAndroidTvRemoteCredentials,
    // PAIRED carries the full credentials; createCredentials refreshes lastUpdated.
    fromPairedEvent: (event) => createCredentials(event.credentials),
    hasCredentials: (credentials) => !!credentials?.certificate,
  },
  extraContext: () => ({ pairingCode: "" }),
  extraContextOnReset: { pairingCode: "" },
  extraActions: {
    setPairingCode: assign({
      pairingCode: (_: unknown, params: { code: string }) => params.code,
    }),
    clearPairingCode: assign({
      pairingCode: "",
    }),
  },
  pairing: {
    logic: pairingActor,
    input: (context) => ({ ip: context.deviceIp }),
    invokeId: "pairingConnection",
    promptTarget: "waitingForUser",
    retryActions: ["clearError", "clearPairingCode"],
    states: ({ userInputTimeout }) => ({
      waitingForUser: {
        on: {
          SET_PAIRING_CODE: {
            actions: {
              type: "setPairingCode",
              params: ({ event }: { event: { type: "SET_PAIRING_CODE"; code: string } }) => ({
                code: event.code,
              }),
            },
          },
          SUBMIT_CODE: {
            target: "verifying",
            actions: sendTo(
              "pairingConnection",
              ({ event }: { event: { type: "SUBMIT_CODE"; code: string } }) => ({
                type: "SUBMIT_CODE" as const,
                code: event.code,
              }),
            ),
          },
        },
        after: { pairingUserInputTimeout: userInputTimeout },
      },
      verifying: {
        after: { pairingUserInputTimeout: userInputTimeout },
      },
    }),
  },
  session: {
    logic: sessionActor,
    input: (context) => ({
      ip: context.deviceIp,
      credentials: context.credentials as AndroidTvRemoteCredentials,
      deviceName: context.deviceName,
    }),
  },
});

export type AndroidTvRemoteDeviceMachine = typeof androidTvRemoteDeviceMachine;
export type AndroidTvRemoteDeviceMachineActor = Actor<AndroidTvRemoteDeviceMachine>;
export type AndroidTvRemoteDeviceMachineSnapshot = SnapshotFrom<
  typeof androidTvRemoteDeviceMachine
>;
