import { type Actor, assign, sendTo, setup } from "xstate";
import type { RemoteKey, TVPlatform } from "../../../types";
import { logger } from "../../../utils/logger";
import { isValidIp } from "../../../utils/network";
import { calculateRetryDelay, HEARTBEAT_INTERVAL } from "../../constants";
import type { WebOSCredentials } from "../credentials";
import { createCredentials, validateWebOSCredentials } from "../credentials";
import { pairingActor } from "./actors/pairing";
import { sessionActor } from "./actors/session";

interface PlatformMachineInput {
  deviceId: string;
  deviceName: string;
  deviceIp: string;
  platform: TVPlatform;
  credentials?: unknown;
}

export interface WebOSSetupInput {
  platform: "lg-webos";
}

export interface WebOSLoadInput extends PlatformMachineInput {
  platform: "lg-webos";
}

export type WebOSMachineInput = WebOSSetupInput | WebOSLoadInput;

function isLoadInput(input: WebOSMachineInput): input is WebOSLoadInput {
  return "deviceId" in input && "deviceName" in input && "deviceIp" in input;
}

interface WebOSMachineContext {
  deviceId: string | null;
  deviceName: string;
  deviceIp: string;
  credentials?: WebOSCredentials;
  retryCount: number;
  maxRetries: number;
  error?: string;
  promptReceived: boolean;
  muteState: boolean;
  useSsl: boolean;
}

type WebOSMachineEvent =
  | { type: "SET_DEVICE_INFO"; name: string; ip: string }
  | { type: "SUBMIT_DEVICE_INFO" }
  | { type: "CONNECT" }
  | { type: "DISCONNECT" }
  | { type: "CONNECTION_LOST"; error?: string }
  | { type: "START_PAIRING" }
  | { type: "RESET_TO_SETUP" }
  | { type: "PROMPT_RECEIVED" }
  | { type: "PAIRED"; clientKey: string }
  | { type: "PAIRING_ERROR"; error: string }
  | { type: "FORGET" }
  | { type: "SEND_KEY"; key: RemoteKey }
  | { type: "SEND_TEXT"; text: string }
  | { type: "CONNECTED" }
  | { type: "HEARTBEAT_OK" }
  | { type: "HEARTBEAT_FAILED"; error: string }
  | { type: "MUTE_STATE_CHANGED"; mute: boolean }
  | { type: "CANCEL" };

export const webosDeviceMachine = setup({
  types: {
    context: {} as WebOSMachineContext,
    events: {} as WebOSMachineEvent,
    input: {} as WebOSMachineInput,
  },
  actors: {
    pairingConnection: pairingActor,
    connectionManager: sessionActor,
  },
  actions: {
    setDeviceInfo: assign({
      deviceName: (_, params: { name: string; ip: string }) => params.name,
      deviceIp: (_, params: { name: string; ip: string }) => params.ip,
      error: undefined,
    }),
    generateDeviceId: assign({
      deviceId: () => crypto.randomUUID(),
    }),
    setValidationError: assign({
      error: (_, params: { error: string }) => params.error,
    }),
    incrementRetry: assign({
      retryCount: ({ context }) => context.retryCount + 1,
    }),
    resetRetry: assign({
      retryCount: 0,
      error: undefined,
    }),
    setError: assign({
      error: (_, params: { error: string }) => params.error,
    }),
    clearError: assign({
      error: undefined,
    }),
    setPromptReceived: assign({
      promptReceived: true,
    }),
    setCredentials: assign({
      credentials: ({ context }, params: { clientKey: string }) =>
        createCredentials({ clientKey: params.clientKey, useSsl: context.useSsl }),
    }),
    clearCredentials: assign({
      credentials: undefined,
    }),
    resetDeviceInfo: assign({
      deviceId: null,
      deviceName: "",
      deviceIp: "",
      error: undefined,
      promptReceived: false,
      useSsl: false,
    }),
    setMuteState: assign({
      muteState: (_, params: { mute: boolean }) => params.mute,
    }),
    enableSsl: assign({
      useSsl: true,
    }),
    log: ({ context }, params: { message: string }) => {
      logger.info("WebOS", params.message, { ip: context.deviceIp });
    },
  },
  guards: {
    isSetupMode: ({ context }) => context.deviceId === null,
    hasCredentials: ({ context }) => !!context.credentials?.clientKey,
    canRetry: ({ context }) => context.retryCount < context.maxRetries,
    hasValidDeviceInfo: (_, params: { name: string; ip: string }) =>
      params.name.trim().length > 0 && isValidIp(params.ip),
    missingDeviceName: (_, params: { name: string }) => params.name.trim().length === 0,
    hasInvalidIp: (_, params: { ip: string }) => !isValidIp(params.ip),
    shouldRetrySsl: ({ context }, params: { error: string }) =>
      !context.useSsl && params.error.includes("ECONNRESET"),
  },
  delays: {
    retryDelay: ({ context }) => calculateRetryDelay(context.retryCount),
    heartbeatInterval: HEARTBEAT_INTERVAL,
  },
}).createMachine({
  id: "webosDevice",
  initial: "initializing",
  context: ({ input }) => {
    // Setup mode: new device, needs to collect info
    if (!isLoadInput(input)) {
      return {
        deviceId: null,
        deviceName: "",
        deviceIp: "",
        credentials: undefined,
        retryCount: 0,
        maxRetries: 5,
        promptReceived: false,
        muteState: false,
        useSsl: false,
      };
    }

    // Load mode: existing device with all info
    let credentials: WebOSCredentials | undefined;
    if (input.credentials) {
      try {
        credentials = validateWebOSCredentials(input.credentials);
      } catch {
        credentials = undefined;
      }
    }

    return {
      deviceId: input.deviceId,
      deviceName: input.deviceName,
      deviceIp: input.deviceIp,
      credentials,
      retryCount: 0,
      maxRetries: 5,
      promptReceived: false,
      muteState: false,
      useSsl: credentials?.useSsl ?? false,
    };
  },
  states: {
    initializing: {
      always: [
        { guard: "isSetupMode", target: "setup" },
        { guard: "hasCredentials", target: "disconnected" },
        { target: "pairing.idle" },
      ],
    },
    setup: {
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
            target: "pairing.active",
            actions: [
              {
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
              "generateDeviceId",
              {
                type: "log",
                params: ({ context }) => ({
                  message: `Starting pairing for ${context.deviceName}`,
                }),
              },
            ],
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
    pairing: {
      initial: "idle",
      on: {
        RESET_TO_SETUP: {
          target: "#webosDevice.setup",
          actions: "resetDeviceInfo",
        },
      },
      states: {
        idle: {
          on: {
            START_PAIRING: {
              target: "active",
              actions: {
                type: "log",
                params: ({ context }) => ({
                  message: `Starting pairing for ${context.deviceName}`,
                }),
              },
            },
          },
        },
        active: {
          initial: "connecting",
          invoke: {
            src: "pairingConnection",
            input: ({ context }) => ({
              ip: context.deviceIp,
              useSsl: context.useSsl,
            }),
          },
          on: {
            PAIRED: {
              target: "#webosDevice.disconnected",
              actions: [
                { type: "setCredentials", params: ({ event }) => ({ clientKey: event.clientKey }) },
                {
                  type: "log",
                  params: ({ context }) => ({
                    message: `Pairing successful for ${context.deviceName}`,
                  }),
                },
              ],
            },
            PAIRING_ERROR: [
              {
                guard: {
                  type: "shouldRetrySsl",
                  params: ({ event }: { event: { type: "PAIRING_ERROR"; error: string } }) => ({
                    error: event.error,
                  }),
                },
                target: "active",
                actions: [
                  "enableSsl",
                  {
                    type: "log",
                    params: { message: "Connection reset - retrying with SSL" },
                  },
                ],
              },
              {
                target: ".error",
                actions: { type: "setError", params: ({ event }) => ({ error: event.error }) },
              },
            ],
          },
          states: {
            connecting: {
              on: {
                PROMPT_RECEIVED: {
                  target: "waitingForUser",
                  actions: "setPromptReceived",
                },
              },
            },
            waitingForUser: {},
            error: {
              on: {
                START_PAIRING: { target: "connecting", actions: "clearError" },
              },
            },
          },
        },
      },
    },
    disconnected: {
      entry: {
        type: "log",
        params: ({ context }) => ({ message: `Disconnected from ${context.deviceName}` }),
      },
      on: {
        CONNECT: { target: "session", actions: "resetRetry" },
        FORGET: { target: "pairing.idle", actions: "clearCredentials" },
      },
    },
    session: {
      type: "parallel",
      invoke: {
        id: "connectionManager",
        src: "connectionManager",
        input: ({ context }) => {
          if (!context.credentials) {
            throw new Error("Cannot connect without credentials");
          }
          return {
            ip: context.deviceIp,
            credentials: context.credentials,
            deviceName: context.deviceName,
            useSsl: context.useSsl,
          };
        },
      },
      on: {
        DISCONNECT: { target: "disconnected", actions: "resetRetry" },
        CONNECTION_LOST: [
          {
            target: ".connection.retrying",
            guard: "canRetry",
            actions: [
              "incrementRetry",
              { type: "setError", params: ({ event }) => ({ error: event.error ?? "Unknown" }) },
            ],
          },
          {
            target: "error",
            actions: { type: "setError", params: { error: "Max retries exceeded" } },
          },
        ],
        HEARTBEAT_FAILED: [
          {
            target: ".connection.retrying",
            guard: "canRetry",
            actions: [
              "incrementRetry",
              { type: "setError", params: ({ event }) => ({ error: event.error }) },
            ],
          },
          {
            target: "error",
            actions: { type: "setError", params: { error: "Max retries exceeded" } },
          },
        ],
        FORGET: { target: "pairing.idle", actions: ["clearCredentials", "resetRetry"] },
      },
      states: {
        connection: {
          initial: "connecting",
          states: {
            connecting: {
              entry: {
                type: "log",
                params: ({ context }) => ({ message: `Connecting to ${context.deviceName}` }),
              },
              on: {
                CONNECTED: { target: "connected", actions: "resetRetry" },
              },
            },
            connected: {
              entry: {
                type: "log",
                params: ({ context }) => ({ message: `Connected to ${context.deviceName}` }),
              },
              on: {
                SEND_KEY: {
                  actions: sendTo("connectionManager", ({ event }) => event),
                },
                SEND_TEXT: {
                  actions: sendTo("connectionManager", ({ event }) => event),
                },
                MUTE_STATE_CHANGED: {
                  actions: { type: "setMuteState", params: ({ event }) => ({ mute: event.mute }) },
                },
              },
            },
            retrying: {
              entry: {
                type: "log",
                params: ({ context }) => ({
                  message: `Retrying connection (${context.retryCount}/${context.maxRetries})`,
                }),
              },
              after: {
                retryDelay: { target: "#webosDevice.session", reenter: true },
              },
            },
          },
        },
        heartbeat: {
          initial: "waiting",
          states: {
            waiting: {
              on: {
                CONNECTED: { target: "idle" },
              },
            },
            idle: {
              after: {
                heartbeatInterval: { target: "checking" },
              },
            },
            checking: {
              entry: sendTo("connectionManager", { type: "CHECK_HEARTBEAT" }),
              on: {
                HEARTBEAT_OK: { target: "idle" },
                HEARTBEAT_FAILED: { target: "waiting" },
              },
            },
          },
        },
      },
    },
    error: {
      on: {
        CONNECT: { target: "session", actions: "resetRetry" },
        DISCONNECT: { target: "disconnected", actions: "resetRetry" },
        FORGET: { target: "pairing.idle", actions: ["clearCredentials", "resetRetry"] },
      },
    },
    cancelled: {
      type: "final",
    },
  },
});

export type WebOSDeviceMachine = typeof webosDeviceMachine;
export type WebOSDeviceMachineActor = Actor<WebOSDeviceMachine>;
