import { assign, fromCallback, setup } from "xstate";
import type { PairingInput, PairingOutput } from "../../../machines/pairing/types";
import { createWebOSConnection } from "../connection";
import { createCredentials } from "../credentials";

interface WebOSPairingContext {
  input: PairingInput;
  clientKey?: string;
  error?: string;
  promptReceived: boolean;
}

type WebOSPairingEvent =
  | { type: "SUBMIT" }
  | { type: "CHAR_INPUT"; char: string }
  | { type: "BACKSPACE" }
  | { type: "PROMPT_RECEIVED" }
  | { type: "PAIRED"; clientKey: string }
  | { type: "CONNECTION_ERROR"; error: string };

export const webosPairingMachine = setup({
  types: {
    context: {} as WebOSPairingContext,
    events: {} as WebOSPairingEvent,
    input: {} as PairingInput,
    output: {} as PairingOutput,
  },
  actors: {
    maintainConnection: fromCallback<WebOSPairingEvent, { ip: string }>(({ input, sendBack }) => {
      const connection = createWebOSConnection({
        ip: input.ip,
        mac: "",
        timeout: 30000,
        reconnect: 0,
      });

      connection.on("prompt", () => {
        sendBack({ type: "PROMPT_RECEIVED" });
      });

      connection.on("connect", () => {
        const clientKey = connection.getClientKey();
        if (clientKey) {
          sendBack({ type: "PAIRED", clientKey });
        }
      });

      connection.on("error", (error) => {
        sendBack({ type: "CONNECTION_ERROR", error: String(error) });
      });

      connection.connect().catch((err) => {
        sendBack({ type: "CONNECTION_ERROR", error: String(err) });
      });

      return () => {
        connection.disconnect();
      };
    }),
  },
  actions: {
    setClientKey: assign({
      clientKey: (_, params: { clientKey: string }) => params.clientKey,
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
  },
}).createMachine({
  id: "webosPairing",
  initial: "connecting",
  context: ({ input }) => ({
    input,
    promptReceived: false,
  }),
  states: {
    connecting: {
      initial: "initiating",
      invoke: {
        src: "maintainConnection",
        input: ({ context }) => ({ ip: context.input.deviceIp }),
      },
      on: {
        PAIRED: {
          target: "success",
          actions: {
            type: "setClientKey",
            params: ({ event }) => ({ clientKey: event.clientKey }),
          },
        },
        CONNECTION_ERROR: {
          target: "error",
          actions: {
            type: "setError",
            params: ({ event }) => ({ error: event.error }),
          },
        },
      },
      states: {
        initiating: {
          entry: "clearError",
          on: {
            PROMPT_RECEIVED: {
              target: "waiting",
              actions: "setPromptReceived",
            },
          },
        },
        waiting: {
          // User sees prompt on TV, waiting for them to accept
          // The callback will automatically send PAIRED when accepted
          // No manual polling needed - just wait for the event
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
  output: ({ context }): PairingOutput => ({
    credentials: context.clientKey ? createCredentials({ clientKey: context.clientKey }) : null,
  }),
});
