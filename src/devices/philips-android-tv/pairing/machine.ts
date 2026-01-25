import { assign, assertEvent, fromPromise, setup } from "xstate";
import type { PairingInput, PairingOutput } from "../../../machines/pairing/types";
import { createPhilipsConnection } from "../connection";
import type { PhilipsCredentials } from "../credentials";

interface PairingData {
  authKey: string;
  timestamp: number;
  deviceId: string;
}

interface PhilipsPairingContext {
  input: PairingInput;
  pairingData: PairingData | null;
  credentials?: PhilipsCredentials;
  error?: string;
}

type PhilipsPairingEvent =
  | { type: "SUBMIT_PIN"; pin: string }
  | { type: "RETRY" };

export const philipsPairingMachine = setup({
  types: {
    context: {} as PhilipsPairingContext,
    events: {} as PhilipsPairingEvent,
    input: {} as PairingInput,
    output: {} as PairingOutput,
  },
  actors: {
    startPairing: fromPromise<PairingData, { ip: string }>(async ({ input }) => {
      const connection = createPhilipsConnection(input.ip);
      return await connection.startPairing("BaghdadRemote");
    }),
    confirmPairing: fromPromise<
      PhilipsCredentials,
      { ip: string; pin: string; pairingData: PairingData }
    >(async ({ input }) => {
      const connection = createPhilipsConnection(input.ip);
      return await connection.confirmPairing(
        input.pin,
        input.pairingData.authKey,
        input.pairingData.timestamp,
        input.pairingData.deviceId,
        "BaghdadRemote",
      );
    }),
  },
  guards: {
    hasValidPin: (_, params: { pin: string }) => /^\d{4}$/.test(params.pin),
  },
  actions: {
    setPairingData: assign({
      pairingData: (_, params: { data: PairingData }) => params.data,
    }),
    setCredentials: assign({
      credentials: (_, params: { credentials: PhilipsCredentials }) => params.credentials,
    }),
    setError: assign({
      error: (_, params: { error: string }) => params.error,
    }),
    clearError: assign({
      error: undefined,
    }),
  },
}).createMachine({
  id: "philipsPairing",
  initial: "startingPairing",
  context: ({ input }) => ({
    input,
    pairingData: null,
  }),
  states: {
    startingPairing: {
      invoke: {
        src: "startPairing",
        input: ({ context }) => ({ ip: context.input.deviceIp }),
        onDone: {
          target: "enteringPin",
          actions: {
            type: "setPairingData",
            params: ({ event }) => ({ data: event.output }),
          },
        },
        onError: {
          target: "error",
          actions: {
            type: "setError",
            params: ({ event }) => ({ error: String(event.error) }),
          },
        },
      },
    },
    enteringPin: {
      on: {
        SUBMIT_PIN: [
          {
            guard: {
              type: "hasValidPin",
              params: ({ event }) => ({ pin: event.pin }),
            },
            target: "confirmingPairing",
          },
          {
            actions: {
              type: "setError",
              params: { error: "Please enter a valid 4-digit PIN" },
            },
          },
        ],
      },
    },
    confirmingPairing: {
      invoke: {
        src: "confirmPairing",
        input: ({ context, event }) => {
          assertEvent(event, "SUBMIT_PIN");
          return {
            ip: context.input.deviceIp,
            pin: event.pin,
            pairingData: context.pairingData!,
          };
        },
        onDone: {
          target: "success",
          actions: {
            type: "setCredentials",
            params: ({ event }) => ({ credentials: event.output }),
          },
        },
        onError: {
          target: "enteringPin",
          actions: {
            type: "setError",
            params: ({ event }) => ({ error: `Pairing failed: ${event.error}` }),
          },
        },
      },
    },
    success: {
      type: "final",
    },
    error: {
      on: {
        RETRY: { target: "startingPairing", actions: "clearError" },
      },
    },
  },
  output: ({ context }): PairingOutput => ({
    credentials: context.credentials,
  }),
});
