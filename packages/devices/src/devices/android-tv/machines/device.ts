import { type Actor, assign, type SnapshotFrom, sendTo, setup } from "xstate";
import type { RemoteKey, TVPlatform } from "../../../types";
import { logger } from "../../../utils/logger";
import { isValidIp } from "../../../utils/network";
import { calculateRetryDelay, HEARTBEAT_INTERVAL } from "../../constants";
import type { CommonDeviceEvent } from "../../commonEvents";
import { pairingActor } from "./actors/pairing";
import { sessionActor } from "./actors/session";

export const INSTRUCTION_STEPS = [
  {
    title: "Enable Developer Options",
    description: "Go to Settings > Device Preferences > About and tap Build number 7 times",
  },
  {
    title: "Enable ADB Debugging",
    description:
      "Go to Settings > Device Preferences > Developer options and enable 'Network debugging' or 'ADB debugging'",
  },
];

interface PlatformMachineInput {
  deviceId: string;
  deviceName: string;
  deviceIp: string;
  platform: TVPlatform;
}

export interface AndroidTVSetupInput {
  platform: "android-tv";
}

export interface AndroidTVLoadInput extends PlatformMachineInput {
  platform: "android-tv";
}

export type AndroidTVMachineInput = AndroidTVSetupInput | AndroidTVLoadInput;

function isLoadInput(input: AndroidTVMachineInput): input is AndroidTVLoadInput {
  return "deviceId" in input && "deviceName" in input && "deviceIp" in input;
}

interface AndroidTVMachineContext {
  deviceId: string | null;
  deviceName: string;
  deviceIp: string;
  retryCount: number;
  maxRetries: number;
  error?: string;
  promptReceived: boolean;
  instructionStep: number;
}

type AndroidTVMachineEvent =
  | CommonDeviceEvent
  // Platform-specific events
  | { type: "SET_DEVICE_INFO"; name: string; ip: string }
  | { type: "SUBMIT_DEVICE_INFO" }
  | { type: "START_PAIRING" }
  | { type: "RESET_TO_SETUP" }
  | { type: "CONTINUE_INSTRUCTION" }
  | { type: "BACK_INSTRUCTION" }
  | { type: "PROMPT_RECEIVED" }
  | { type: "PAIRED" }
  | { type: "PAIRING_ERROR"; error: string };

export const androidTVDeviceMachine = setup({
  types: {
    context: {} as AndroidTVMachineContext,
    events: {} as AndroidTVMachineEvent,
    input: {} as AndroidTVMachineInput,
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
    resetDeviceInfo: assign({
      deviceId: null,
      deviceName: "",
      deviceIp: "",
      error: undefined,
      promptReceived: false,
      instructionStep: 0,
    }),
    nextInstructionStep: assign({
      instructionStep: ({ context }) => context.instructionStep + 1,
    }),
    prevInstructionStep: assign({
      instructionStep: ({ context }) => context.instructionStep - 1,
    }),
    resetInstructionStep: assign({
      instructionStep: 0,
    }),
    log: ({ context }, params: { message: string }) => {
      logger.info("ADB", params.message, { ip: context.deviceIp });
    },
  },
  guards: {
    isSetupMode: ({ context }) => context.deviceId === null,
    canRetry: ({ context }) => context.retryCount < context.maxRetries,
    hasValidDeviceInfo: (_, params: { name: string; ip: string }) =>
      params.name.trim().length > 0 && isValidIp(params.ip),
    missingDeviceName: (_, params: { name: string }) => params.name.trim().length === 0,
    hasInvalidIp: (_, params: { ip: string }) => !isValidIp(params.ip),
    hasMoreInstructionSteps: ({ context }) =>
      context.instructionStep < INSTRUCTION_STEPS.length - 1,
    canGoBackInInstructions: ({ context }) => context.instructionStep > 0,
  },
  delays: {
    retryDelay: ({ context }) => calculateRetryDelay(context.retryCount),
    heartbeatInterval: HEARTBEAT_INTERVAL,
  },
}).createMachine({
  id: "androidTVDevice",
  initial: "initializing",
  context: ({ input }) => {
    if (!isLoadInput(input)) {
      return {
        deviceId: null,
        deviceName: "",
        deviceIp: "",
        retryCount: 0,
        maxRetries: 5,
        promptReceived: false,
        instructionStep: 0,
      };
    }

    return {
      deviceId: input.deviceId,
      deviceName: input.deviceName,
      deviceIp: input.deviceIp,
      retryCount: 0,
      maxRetries: 5,
      promptReceived: false,
      instructionStep: 0,
    };
  },
  states: {
    initializing: {
      always: [{ guard: "isSetupMode", target: "setup" }, { target: "disconnected" }],
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
            target: "pairing.instructions",
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
          target: "#androidTVDevice.setup",
          actions: "resetDeviceInfo",
        },
      },
      states: {
        idle: {
          on: {
            START_PAIRING: {
              target: "instructions",
              actions: "resetInstructionStep",
            },
          },
        },
        instructions: {
          on: {
            CONTINUE_INSTRUCTION: [
              {
                guard: "hasMoreInstructionSteps",
                actions: "nextInstructionStep",
              },
              {
                target: "active",
                actions: {
                  type: "log",
                  params: ({ context }) => ({
                    message: `Starting pairing for ${context.deviceName}`,
                  }),
                },
              },
            ],
            BACK_INSTRUCTION: [
              {
                guard: "canGoBackInInstructions",
                actions: "prevInstructionStep",
              },
              {
                target: "#androidTVDevice.setup",
                actions: "resetDeviceInfo",
              },
            ],
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
              target: "#androidTVDevice.disconnected",
              actions: {
                type: "log",
                params: ({ context }) => ({
                  message: `Pairing successful for ${context.deviceName}`,
                }),
              },
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
        FORGET: { target: "pairing.idle" },
      },
    },
    session: {
      type: "parallel",
      invoke: {
        id: "connectionManager",
        src: "connectionManager",
        input: ({ context }) => ({
          ip: context.deviceIp,
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
        FORGET: { target: "pairing.idle", actions: "resetRetry" },
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
                retryDelay: { target: "#androidTVDevice.session", reenter: true },
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
        FORGET: { target: "pairing.idle", actions: "resetRetry" },
      },
    },
    cancelled: {
      type: "final",
    },
  },
});

export type AndroidTVDeviceMachine = typeof androidTVDeviceMachine;
export type AndroidTVDeviceMachineActor = Actor<AndroidTVDeviceMachine>;
export type AndroidTVDeviceMachineSnapshot = SnapshotFrom<typeof androidTVDeviceMachine>;
