import { type Actor, assign, sendTo, setup } from "xstate";
import type { TVPlatform } from "../../../types";
import { logger } from "../../../utils/logger";
import { isValidIp } from "../../../utils/network";
import type { CommonDeviceEvent } from "../../commonEvents";
import {
  CONNECTION_TIMEOUT,
  calculateRetryDelay,
  HEARTBEAT_INTERVAL,
  MAX_SESSION_RETRIES,
  PAIRING_CONNECT_TIMEOUT,
  PAIRING_USER_INPUT_TIMEOUT,
} from "../../constants";
import type { TizenCredentials } from "../credentials";
import { createCredentials, validateTizenCredentials } from "../credentials";
import { pairingActor } from "./actors/pairing";
import { sessionActor } from "./actors/session";

interface PlatformMachineInput {
  deviceId: string;
  deviceName: string;
  deviceIp: string;
  platform: TVPlatform;
  credentials?: unknown;
}

export interface TizenSetupInput {
  platform: "samsung-tizen";
}

export interface TizenLoadInput extends PlatformMachineInput {
  platform: "samsung-tizen";
}

export type TizenMachineInput = TizenSetupInput | TizenLoadInput;

function isLoadInput(input: TizenMachineInput): input is TizenLoadInput {
  return "deviceId" in input && "deviceName" in input && "deviceIp" in input;
}

interface TizenMachineContext {
  deviceId: string | null;
  deviceName: string;
  deviceIp: string;
  credentials?: TizenCredentials;
  retryCount: number;
  maxRetries: number;
  error?: string;
  promptReceived: boolean;
}

type TizenMachineEvent =
  | CommonDeviceEvent
  // Platform-specific events
  | { type: "SET_DEVICE_INFO"; name: string; ip: string }
  | { type: "START_PAIRING" }
  | { type: "RESET_TO_SETUP" }
  | { type: "PROMPT_RECEIVED" }
  | { type: "PAIRED"; token: string }
  | { type: "PAIRING_ERROR"; error: string };

export const tizenDeviceMachine = setup({
  types: {
    context: {} as TizenMachineContext,
    events: {} as TizenMachineEvent,
    input: {} as TizenMachineInput,
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
      credentials: (_, params: { token: string }) => createCredentials({ token: params.token }),
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
      logger.info("Tizen", params.message, { ip: context.deviceIp });
    },
  },
  guards: {
    isSetupMode: ({ context }) => context.deviceId === null,
    hasCredentials: ({ context }) => !!context.credentials?.token,
    canRetry: ({ context }) => context.retryCount < context.maxRetries,
    hasValidDeviceInfo: (_, params: { name: string; ip: string }) =>
      params.name.trim().length > 0 && isValidIp(params.ip),
    missingDeviceName: (_, params: { name: string }) => params.name.trim().length === 0,
    hasInvalidIp: (_, params: { ip: string }) => !isValidIp(params.ip),
  },
  delays: {
    connectionTimeout: CONNECTION_TIMEOUT,
    retryDelay: ({ context }) => calculateRetryDelay(context.retryCount),
    heartbeatInterval: HEARTBEAT_INTERVAL,
    pairingConnectTimeout: PAIRING_CONNECT_TIMEOUT,
    pairingUserInputTimeout: PAIRING_USER_INPUT_TIMEOUT,
  },
}).createMachine({
  id: "tizenDevice",
  initial: "initializing",
  context: ({ input }) => {
    if (!isLoadInput(input)) {
      return {
        deviceId: null,
        deviceName: "",
        deviceIp: "",
        credentials: undefined,
        retryCount: 0,
        maxRetries: MAX_SESSION_RETRIES,
        promptReceived: false,
      };
    }

    let credentials: TizenCredentials | undefined;
    let error: string | undefined;
    if (input.credentials) {
      try {
        credentials = validateTizenCredentials(input.credentials);
      } catch (validationError) {
        logger.warn(
          "Tizen",
          `Invalid stored credentials for device ${input.deviceId}: ${validationError}`,
        );
        credentials = undefined;
        error = "Stored credentials are invalid — pair again";
      }
    }

    return {
      deviceId: input.deviceId,
      deviceName: input.deviceName,
      deviceIp: input.deviceIp,
      credentials,
      retryCount: 0,
      maxRetries: MAX_SESSION_RETRIES,
      error,
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
          target: "#tizenDevice.setup",
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
            }),
          },
          on: {
            PAIRED: {
              target: "#tizenDevice.disconnected",
              actions: [
                { type: "setCredentials", params: ({ event }) => ({ token: event.token }) },
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
                  target: "waitingForUser",
                  actions: "setPromptReceived",
                },
              },
              after: {
                pairingConnectTimeout: {
                  target: "#tizenDevice.error",
                  actions: {
                    type: "setError",
                    params: {
                      error: "Pairing timed out — make sure the TV is on and accepting connections",
                    },
                  },
                },
              },
            },
            waitingForUser: {
              after: {
                pairingUserInputTimeout: {
                  target: "#tizenDevice.error",
                  actions: {
                    type: "setError",
                    params: {
                      error: "Pairing timed out — make sure the TV is on and accepting connections",
                    },
                  },
                },
              },
            },
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
        CONNECT: { target: "session", guard: "hasCredentials", actions: "resetRetry" },
        FORGET: { target: "pairing.idle", actions: "clearCredentials" },
      },
    },
    session: {
      type: "parallel",
      invoke: {
        id: "connectionManager",
        src: "connectionManager",
        input: ({ context }) => ({
          ip: context.deviceIp,
          credentials: context.credentials as TizenCredentials,
          deviceName: context.deviceName,
        }),
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
              after: {
                connectionTimeout: [
                  {
                    target: "retrying",
                    guard: "canRetry",
                    actions: [
                      "incrementRetry",
                      { type: "setError", params: { error: "Connection timed out" } },
                    ],
                  },
                  {
                    target: "#tizenDevice.error",
                    actions: { type: "setError", params: { error: "Connection timed out" } },
                  },
                ],
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
                retryDelay: { target: "#tizenDevice.session", reenter: true },
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
        CONNECT: { target: "session", guard: "hasCredentials", actions: "resetRetry" },
        DISCONNECT: { target: "disconnected", actions: "resetRetry" },
        FORGET: { target: "pairing.idle", actions: ["clearCredentials", "resetRetry"] },
      },
    },
    cancelled: {
      type: "final",
    },
  },
});

export type TizenDeviceMachine = typeof tizenDeviceMachine;
export type TizenDeviceMachineActor = Actor<TizenDeviceMachine>;
