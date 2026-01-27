import { type Actor, assign, sendTo, setup } from "xstate";
import type { RemoteKey, TVPlatform } from "../../../types";
import { logger } from "../../../utils/logger";
import { isValidIp } from "../../../utils/network";
import { calculateRetryDelay, HEARTBEAT_INTERVAL } from "../../constants";
import type { PhilipsCredentials } from "../credentials";
import { validatePhilipsCredentials } from "../credentials";
import { pairingActor } from "./actors/pairing";
import { sessionActor } from "./actors/session";

interface PlatformMachineInput {
  deviceId: string;
  deviceName: string;
  deviceIp: string;
  platform: TVPlatform;
  credentials?: unknown;
}

export interface PhilipsSetupInput {
  platform: "philips-android-tv";
}

export interface PhilipsLoadInput extends PlatformMachineInput {
  platform: "philips-android-tv";
}

export type PhilipsMachineInput = PhilipsSetupInput | PhilipsLoadInput;

function isLoadInput(input: PhilipsMachineInput): input is PhilipsLoadInput {
  return "deviceId" in input && "deviceName" in input && "deviceIp" in input;
}

interface PhilipsMachineContext {
  deviceId: string | null;
  deviceName: string;
  deviceIp: string;
  credentials?: PhilipsCredentials;
  retryCount: number;
  maxRetries: number;
  error?: string;
  promptReceived: boolean;
}

type PhilipsMachineEvent =
  | { type: "SET_DEVICE_INFO"; name: string; ip: string }
  | { type: "SUBMIT_DEVICE_INFO" }
  | { type: "CONNECT" }
  | { type: "DISCONNECT" }
  | { type: "CONNECTION_LOST"; error?: string }
  | { type: "START_PAIRING" }
  | { type: "RESET_TO_SETUP" }
  | { type: "PROMPT_RECEIVED" }
  | { type: "SUBMIT_PIN"; pin: string }
  | { type: "PAIRED"; credentials: PhilipsCredentials }
  | { type: "PAIRING_ERROR"; error: string }
  | { type: "FORGET" }
  | { type: "SEND_KEY"; key: RemoteKey }
  | { type: "CONNECTED" }
  | { type: "HEARTBEAT_OK" }
  | { type: "HEARTBEAT_FAILED"; error: string }
  | { type: "CANCEL" };

export const philipsDeviceMachine = setup({
  types: {
    context: {} as PhilipsMachineContext,
    events: {} as PhilipsMachineEvent,
    input: {} as PhilipsMachineInput,
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
      credentials: (_, params: { credentials: PhilipsCredentials }) => params.credentials,
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
    }),
    log: ({ context }, params: { message: string }) => {
      logger.info("Philips", params.message, { ip: context.deviceIp });
    },
  },
  guards: {
    isSetupMode: ({ context }) => context.deviceId === null,
    hasCredentials: ({ context }) =>
      !!context.credentials?.deviceId && !!context.credentials?.authKey,
    canRetry: ({ context }) => context.retryCount < context.maxRetries,
    hasValidDeviceInfo: (_, params: { name: string; ip: string }) =>
      params.name.trim().length > 0 && isValidIp(params.ip),
    missingDeviceName: (_, params: { name: string }) => params.name.trim().length === 0,
    hasInvalidIp: (_, params: { ip: string }) => !isValidIp(params.ip),
  },
  delays: {
    retryDelay: ({ context }) => calculateRetryDelay(context.retryCount),
    heartbeatInterval: HEARTBEAT_INTERVAL,
  },
}).createMachine({
  id: "philipsDevice",
  initial: "initializing",
  context: ({ input }) => {
    if (!isLoadInput(input)) {
      return {
        deviceId: null,
        deviceName: "",
        deviceIp: "",
        credentials: undefined,
        retryCount: 0,
        maxRetries: 5,
        promptReceived: false,
      };
    }

    let credentials: PhilipsCredentials | undefined;
    if (input.credentials) {
      try {
        credentials = validatePhilipsCredentials(input.credentials);
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
          target: "#philipsDevice.setup",
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
            id: "pairingConnection",
            src: "pairingConnection",
            input: ({ context }) => ({
              ip: context.deviceIp,
              deviceName: context.deviceName,
            }),
          },
          on: {
            PAIRED: {
              target: "#philipsDevice.disconnected",
              actions: [
                {
                  type: "setCredentials",
                  params: ({ event }) => ({ credentials: event.credentials }),
                },
                {
                  type: "log",
                  params: ({ context }) => ({
                    message: `Pairing successful for ${context.deviceName}`,
                  }),
                },
              ],
            },
            PAIRING_ERROR: {
              target: ".error",
              actions: { type: "setError", params: ({ event }) => ({ error: event.error }) },
            },
          },
          states: {
            connecting: {
              on: {
                PROMPT_RECEIVED: {
                  target: "waitingForPin",
                  actions: "setPromptReceived",
                },
              },
            },
            waitingForPin: {
              on: {
                SUBMIT_PIN: {
                  target: "confirming",
                  actions: sendTo("pairingConnection", ({ event }) => event),
                },
              },
            },
            confirming: {},
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
                retryDelay: { target: "#philipsDevice.session", reenter: true },
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

export type PhilipsDeviceMachine = typeof philipsDeviceMachine;
export type PhilipsDeviceMachineActor = Actor<PhilipsDeviceMachine>;
