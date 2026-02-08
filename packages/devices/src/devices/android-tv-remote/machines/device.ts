import { type Actor, assign, type SnapshotFrom, sendTo, setup } from "xstate";
import type { RemoteKey, TVPlatform } from "../../../types";
import { logger } from "../../../utils/logger";
import { isValidIp } from "../../../utils/network";
import { calculateRetryDelay, HEARTBEAT_INTERVAL } from "../../constants";
import type { CommonDeviceEvent } from "../../commonEvents";
import type { AndroidTvRemoteCredentials } from "../credentials";
import { createCredentials, validateAndroidTvRemoteCredentials } from "../credentials";
import { pairingActor } from "./actors/pairing";
import { sessionActor } from "./actors/session";

interface PlatformMachineInput {
  deviceId: string;
  deviceName: string;
  deviceIp: string;
  platform: TVPlatform;
  credentials?: unknown;
}

export interface AndroidTvRemoteSetupInput {
  platform: "android-tv-remote";
}

export interface AndroidTvRemoteLoadInput extends PlatformMachineInput {
  platform: "android-tv-remote";
}

export type AndroidTvRemoteMachineInput = AndroidTvRemoteSetupInput | AndroidTvRemoteLoadInput;

function isLoadInput(input: AndroidTvRemoteMachineInput): input is AndroidTvRemoteLoadInput {
  return "deviceId" in input && "deviceName" in input && "deviceIp" in input;
}

interface AndroidTvRemoteMachineContext {
  deviceId: string | null;
  deviceName: string;
  deviceIp: string;
  credentials?: AndroidTvRemoteCredentials;
  retryCount: number;
  maxRetries: number;
  error?: string;
  promptReceived: boolean;
  pairingCode: string;
}

type AndroidTvRemoteMachineEvent =
  | CommonDeviceEvent
  // Platform-specific events
  | { type: "SET_DEVICE_INFO"; name: string; ip: string }
  | { type: "START_PAIRING" }
  | { type: "RESET_TO_SETUP" }
  | { type: "PROMPT_RECEIVED" }
  | { type: "PAIRED"; credentials: AndroidTvRemoteCredentials }
  | { type: "PAIRING_ERROR"; error: string }
  | { type: "SUBMIT_CODE"; code: string }
  | { type: "SET_PAIRING_CODE"; code: string };

export const androidTvRemoteDeviceMachine = setup({
  types: {
    context: {} as AndroidTvRemoteMachineContext,
    events: {} as AndroidTvRemoteMachineEvent,
    input: {} as AndroidTvRemoteMachineInput,
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
      credentials: (_, params: { credentials: AndroidTvRemoteCredentials }) =>
        createCredentials(params.credentials),
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
      pairingCode: "",
    }),
    setPairingCode: assign({
      pairingCode: (_, params: { code: string }) => params.code,
    }),
    clearPairingCode: assign({
      pairingCode: "",
    }),
    log: ({ context }, params: { message: string }) => {
      logger.info("AndroidTVRemote", params.message, { ip: context.deviceIp });
    },
  },
  guards: {
    isSetupMode: ({ context }) => context.deviceId === null,
    hasCredentials: ({ context }) => !!context.credentials?.certificate,
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
  id: "androidTvRemoteDevice",
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
        pairingCode: "",
      };
    }

    let credentials: AndroidTvRemoteCredentials | undefined;
    if (input.credentials) {
      try {
        credentials = validateAndroidTvRemoteCredentials(input.credentials);
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
      pairingCode: "",
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
          target: "#androidTvRemoteDevice.setup",
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
            }),
          },
          on: {
            PAIRED: {
              target: "#androidTvRemoteDevice.disconnected",
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
                  target: "waitingForUser",
                  actions: "setPromptReceived",
                },
              },
            },
            waitingForUser: {
              on: {
                SET_PAIRING_CODE: {
                  actions: {
                    type: "setPairingCode",
                    params: ({ event }) => ({ code: event.code }),
                  },
                },
                SUBMIT_CODE: {
                  target: "verifying",
                  actions: sendTo("pairingConnection", ({ event }) => ({
                    type: "SUBMIT_CODE" as const,
                    code: event.code,
                  })),
                },
              },
            },
            verifying: {},
            error: {
              on: {
                START_PAIRING: {
                  target: "connecting",
                  actions: ["clearError", "clearPairingCode"],
                },
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
                retryDelay: { target: "#androidTvRemoteDevice.session", reenter: true },
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

export type AndroidTvRemoteDeviceMachine = typeof androidTvRemoteDeviceMachine;
export type AndroidTvRemoteDeviceMachineActor = Actor<AndroidTvRemoteDeviceMachine>;
export type AndroidTvRemoteDeviceMachineSnapshot = SnapshotFrom<
  typeof androidTvRemoteDeviceMachine
>;
