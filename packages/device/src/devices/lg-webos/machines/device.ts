import { type Actor, assign } from "xstate";
import {
  createDeviceMachine,
  type DeviceLoadInput,
  type PlatformInput,
} from "../../shared/machine";
import type { WebOSCredentials } from "../credentials";
import { createCredentials, validateWebOSCredentials } from "../credentials";
import { pairingActor } from "./actors/pairing";
import { sessionActor } from "./actors/session";

export type WebOSSetupInput = PlatformInput<"lg-webos">;

export type WebOSLoadInput = DeviceLoadInput<"lg-webos">;

export type WebOSMachineInput = WebOSSetupInput | WebOSLoadInput;

type WebOSPlatformEvent =
  | { type: "PAIRED"; clientKey: string }
  | { type: "MUTE_STATE_CHANGED"; mute: boolean };

type WebOSExtraContext = {
  muteState: boolean;
  useSsl: boolean;
};

export const webosDeviceMachine = createDeviceMachine<
  WebOSMachineInput,
  WebOSCredentials,
  WebOSPlatformEvent,
  WebOSExtraContext,
  typeof pairingActor,
  typeof sessionActor
>({
  id: "webosDevice",
  logCategory: "WebOS",
  credentials: {
    validate: validateWebOSCredentials,
    fromPairedEvent: (event, context) =>
      createCredentials({ clientKey: event.clientKey, useSsl: context.useSsl }),
    hasCredentials: (credentials) => !!credentials?.clientKey,
  },
  extraContext: (credentials) => ({ muteState: false, useSsl: credentials?.useSsl ?? false }),
  extraContextOnReset: { useSsl: false },
  pairing: {
    logic: pairingActor,
    input: (context) => ({ ip: context.deviceIp, useSsl: context.useSsl }),
    retryTarget: "#webosDevice.pairing.active",
    retryActions: ["clearError", "resetPromptReceived"],
    timeoutErrorTarget: "#webosDevice.pairing.active.error",
    promptTarget: "waitingForUser",
    states: ({ userInputTimeout }) => ({
      waitingForUser: {
        after: { pairingUserInputTimeout: userInputTimeout },
      },
    }),
    errorTransitions: [
      {
        guard: {
          type: "shouldRetrySsl",
          params: ({ event }: { event: { type: "PAIRING_ERROR"; error: string } }) => ({
            error: event.error,
          }),
        },
        target: "active",
        reenter: true,
        actions: [
          "enableSsl",
          "resetPromptReceived",
          { type: "log", params: { message: "Connection reset - retrying with SSL" } },
        ],
      },
    ],
  },
  session: {
    logic: sessionActor,
    input: (context) => ({
      deviceId: context.deviceId ?? context.deviceIp,
      ip: context.deviceIp,
      credentials: context.credentials as WebOSCredentials,
      deviceName: context.deviceName,
      useSsl: context.useSsl,
    }),
    connectedOn: {
      MUTE_STATE_CHANGED: {
        actions: {
          type: "setMuteState",
          params: ({ event }: { event: { type: "MUTE_STATE_CHANGED"; mute: boolean } }) => ({
            mute: event.mute,
          }),
        },
      },
    },
  },
  extraActions: {
    setMuteState: assign({
      muteState: (_, params: { mute: boolean }) => params.mute,
    }),
    enableSsl: assign({
      useSsl: true,
    }),
  },
  extraGuards: {
    shouldRetrySsl: ({ context }: { context: WebOSExtraContext }, params: { error: string }) =>
      !context.useSsl &&
      (params.error.includes("ECONNRESET") ||
        params.error.includes("WebSocket connection failed") ||
        params.error.includes("Connection ended")),
  },
});

export type WebOSDeviceMachine = typeof webosDeviceMachine;
export type WebOSDeviceMachineActor = Actor<WebOSDeviceMachine>;
