import { assign, fromPromise, setup } from "xstate";
import type { PairingInput, PairingOutput } from "../../../machines/pairing/types";
import { createADBConnection } from "../connection";

const INFO_STEPS = [
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

export interface AndroidTvPairingContext {
  input: PairingInput;
  currentStepIndex: number;
  error?: string;
}

export type AndroidTvPairingEvent =
  | { type: "SUBMIT" }
  | { type: "CHAR_INPUT"; char: string }
  | { type: "BACKSPACE" };

export const androidTvPairingMachine = setup({
  types: {
    context: {} as AndroidTvPairingContext,
    events: {} as AndroidTvPairingEvent,
    input: {} as PairingInput,
    output: {} as PairingOutput,
  },
  actors: {
    connectAdb: fromPromise<void, { ip: string }>(async ({ input }) => {
      const adb = createADBConnection(input.ip);
      await adb.connect();
    }),
  },
  guards: {
    hasMoreInfoSteps: ({ context }) => context.currentStepIndex < INFO_STEPS.length - 1,
  },
  actions: {
    advanceStep: assign({
      currentStepIndex: ({ context }) => context.currentStepIndex + 1,
    }),
    setError: assign({
      error: (_, params: { error: string }) => params.error,
    }),
    clearError: assign({
      error: undefined,
    }),
  },
}).createMachine({
  id: "androidTvPairing",
  initial: "showingInfo",
  context: ({ input }) => ({
    input,
    currentStepIndex: 0,
  }),
  states: {
    showingInfo: {
      on: {
        SUBMIT: [
          {
            guard: "hasMoreInfoSteps",
            actions: "advanceStep",
          },
          {
            target: "connecting",
          },
        ],
      },
    },
    connecting: {
      invoke: {
        src: "connectAdb",
        input: ({ context }) => ({ ip: context.input.deviceIp }),
        onDone: { target: "success" },
        onError: {
          target: "error",
          actions: {
            type: "setError",
            params: ({ event }) => ({ error: String(event.error) }),
          },
        },
      },
    },
    success: {
      type: "final",
    },
    error: {
      on: {
        SUBMIT: { target: "connecting", actions: "clearError" },
      },
    },
  },
  output: () => ({ credentials: null }),
});

export const INFO_STEPS_DATA = INFO_STEPS;
