import { assign, fromPromise, setup } from "xstate";
import type { PairingInput, PairingOutput } from "../../../machines/pairing/types";
import { createADBConnection } from "../connection";

export const INFO_STEPS = [
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

interface AndroidTvPairingContext {
  input: PairingInput;
  stepIndex: number;
  error?: string;
}

type AndroidTvPairingEvent =
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
    connect: fromPromise<void, { ip: string }>(async ({ input }) => {
      const adb = createADBConnection(input.ip);
      await adb.connect();
    }),
  },
  guards: {
    hasMoreInfoSteps: ({ context }) => context.stepIndex < INFO_STEPS.length - 1,
  },
  actions: {
    nextStep: assign({
      stepIndex: ({ context }) => context.stepIndex + 1,
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
    stepIndex: 0,
  }),
  states: {
    showingInfo: {
      on: {
        SUBMIT: [
          {
            guard: "hasMoreInfoSteps",
            actions: "nextStep",
          },
          {
            target: "connecting",
          },
        ],
      },
    },
    connecting: {
      invoke: {
        src: "connect",
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
  // ADB doesn't require persistent credentials - authorization is stored on the TV
  output: () => ({ credentials: null }),
});
