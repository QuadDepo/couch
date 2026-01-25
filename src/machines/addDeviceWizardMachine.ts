import { type Actor, assign, setup } from "xstate";
import { androidTvPairingMachine } from "../devices/android-tv/pairing/machine.ts";
import { implementedPlatforms } from "../devices/factory.ts";
import { webosPairingMachine } from "../devices/lg-webos/pairing/machine.ts";
import { philipsPairingMachine } from "../devices/philips-android-tv/pairing/machine.ts";
import type { TVPlatform } from "../types/index.ts";
import { isValidIp } from "../utils/network.ts";
import type { PairingOutput } from "./pairing/types.ts";

export const PAIRING_ACTOR_ID = "pairing" as const;

export interface WizardContext {
  platform: TVPlatform | null;
  selectedPlatformIndex: number;
  deviceName: string;
  deviceIp: string;
  credentials: unknown;
  error?: string;
}

type WizardEvent =
  | { type: "ARROW_UP" }
  | { type: "ARROW_DOWN" }
  | { type: "SELECT" }
  | { type: "SET_DEVICE_INFO"; name: string; ip: string }
  | { type: "SUBMIT" }
  | { type: "CANCEL" }
  | { type: "DONE" };

export const addDeviceWizardMachine = setup({
  types: {
    context: {} as WizardContext,
    events: {} as WizardEvent,
  },
  actors: {
    androidTvPairing: androidTvPairingMachine,
    webosPairing: webosPairingMachine,
    philipsPairing: philipsPairingMachine,
  },
  actions: {
    onComplete: () => {},
    onCancel: () => {},
    selectPlatformUp: assign({
      selectedPlatformIndex: ({ context }) => Math.max(0, context.selectedPlatformIndex - 1),
    }),
    selectPlatformDown: assign({
      selectedPlatformIndex: ({ context }) =>
        Math.min(implementedPlatforms.length - 1, context.selectedPlatformIndex + 1),
    }),
    setPlatformFromSelection: assign({
      platform: ({ context }) => implementedPlatforms[context.selectedPlatformIndex]?.id ?? null,
    }),
    setDeviceInfo: assign({
      deviceName: (_, params: { name: string; ip: string }) => params.name,
      deviceIp: (_, params: { name: string; ip: string }) => params.ip,
      error: undefined,
    }),
    setValidationError: assign({
      error: (_, params: { error: string }) => params.error,
    }),
    clearError: assign({
      error: undefined,
    }),
    setCredentials: assign({
      credentials: (_, params: { credentials: unknown }) => params.credentials,
    }),
    setError: assign({
      error: (_, params: { error: string }) => params.error,
    }),
  },
  guards: {
    hasValidDeviceInfo: (_, params: { name: string; ip: string }) =>
      params.name.trim().length > 0 && isValidIp(params.ip),
    missingDeviceName: (_, params: { name: string }) => params.name.trim().length === 0,
    hasInvalidIp: (_, params: { ip: string }) => !isValidIp(params.ip),
    isAndroidTv: ({ context }) => context.platform === "android-tv",
    isWebOS: ({ context }) => context.platform === "lg-webos",
    isPhilips: ({ context }) => context.platform === "philips-android-tv",
  },
}).createMachine({
  id: "addDeviceWizard",
  initial: "platformSelection",
  context: {
    platform: null,
    selectedPlatformIndex: 0,
    deviceName: "",
    deviceIp: "",
    credentials: null,
    error: undefined,
  },
  states: {
    platformSelection: {
      on: {
        ARROW_UP: { actions: "selectPlatformUp" },
        ARROW_DOWN: { actions: "selectPlatformDown" },
        SELECT: {
          target: "deviceInfo",
          actions: "setPlatformFromSelection",
        },
        SUBMIT: {
          target: "deviceInfo",
          actions: "setPlatformFromSelection",
        },
        CANCEL: { target: "cancelled" },
      },
    },
    deviceInfo: {
      on: {
        SET_DEVICE_INFO: [
          {
            guard: {
              type: "hasValidDeviceInfo",
              params: ({
                event,
              }: {
                event: { type: "SET_DEVICE_INFO"; name: string; ip: string };
              }) => ({
                name: event.name,
                ip: event.ip,
              }),
            },
            target: "connection",
            actions: {
              type: "setDeviceInfo",
              params: ({
                event,
              }: {
                event: { type: "SET_DEVICE_INFO"; name: string; ip: string };
              }) => ({
                name: event.name,
                ip: event.ip,
              }),
            },
          },
          {
            guard: {
              type: "missingDeviceName",
              params: ({
                event,
              }: {
                event: { type: "SET_DEVICE_INFO"; name: string; ip: string };
              }) => ({
                name: event.name,
              }),
            },
            actions: {
              type: "setValidationError",
              params: { error: "Device name is required" },
            },
          },
          {
            guard: {
              type: "hasInvalidIp",
              params: ({
                event,
              }: {
                event: { type: "SET_DEVICE_INFO"; name: string; ip: string };
              }) => ({
                ip: event.ip,
              }),
            },
            actions: {
              type: "setValidationError",
              params: { error: "Invalid IP address" },
            },
          },
        ],
        CANCEL: { target: "cancelled" },
      },
    },
    connection: {
      initial: "routing",
      on: {
        CANCEL: { target: "cancelled" },
      },
      states: {
        routing: {
          always: [
            { guard: "isAndroidTv", target: "androidTv" },
            { guard: "isWebOS", target: "webos" },
            { guard: "isPhilips", target: "philips" },
          ],
        },
        androidTv: {
          invoke: {
            id: PAIRING_ACTOR_ID,
            src: "androidTvPairing",
            input: ({ context }) => {
              if (!context.platform) {
                throw new Error("Platform not selected");
              }
              return {
                deviceName: context.deviceName,
                deviceIp: context.deviceIp,
                platform: context.platform,
              };
            },
            onDone: {
              target: "#addDeviceWizard.complete",
              actions: {
                type: "setCredentials",
                params: ({ event }) => ({
                  credentials: (event.output as PairingOutput).credentials,
                }),
              },
            },
            onError: {
              target: "#addDeviceWizard.error",
              actions: {
                type: "setError",
                params: ({ event }) => ({ error: String(event.error) }),
              },
            },
          },
        },
        webos: {
          invoke: {
            id: PAIRING_ACTOR_ID,
            src: "webosPairing",
            input: ({ context }) => {
              if (!context.platform) {
                throw new Error("Platform not selected");
              }
              return {
                deviceName: context.deviceName,
                deviceIp: context.deviceIp,
                platform: context.platform,
              };
            },
            onDone: {
              target: "#addDeviceWizard.complete",
              actions: {
                type: "setCredentials",
                params: ({ event }) => ({
                  credentials: (event.output as PairingOutput).credentials,
                }),
              },
            },
            onError: {
              target: "#addDeviceWizard.error",
              actions: {
                type: "setError",
                params: ({ event }) => ({ error: String(event.error) }),
              },
            },
          },
        },
        philips: {
          invoke: {
            id: PAIRING_ACTOR_ID,
            src: "philipsPairing",
            input: ({ context }) => {
              if (!context.platform) {
                throw new Error("Platform not selected");
              }
              return {
                deviceName: context.deviceName,
                deviceIp: context.deviceIp,
                platform: context.platform,
              };
            },
            onDone: {
              target: "#addDeviceWizard.complete",
              actions: {
                type: "setCredentials",
                params: ({ event }) => ({
                  credentials: (event.output as PairingOutput).credentials,
                }),
              },
            },
            onError: {
              target: "#addDeviceWizard.error",
              actions: {
                type: "setError",
                params: ({ event }) => ({ error: String(event.error) }),
              },
            },
          },
        },
      },
    },
    complete: {
      on: {
        SUBMIT: { target: "done" },
        SELECT: { target: "done" },
        DONE: { target: "done" },
        CANCEL: { target: "done" },
      },
    },
    error: {
      on: {
        SUBMIT: { target: "connection", actions: "clearError" },
        CANCEL: { target: "cancelled" },
      },
    },
    cancelled: {
      type: "final",
      entry: "onCancel",
    },
    done: {
      type: "final",
      entry: "onComplete",
    },
  },
});

export type WizardActorRef = Actor<typeof addDeviceWizardMachine>;

export type PairingActorRef =
  | Actor<typeof androidTvPairingMachine>
  | Actor<typeof webosPairingMachine>
  | Actor<typeof philipsPairingMachine>;
