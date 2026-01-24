import { assign, fromPromise, setup } from "xstate";
import type { TVPlatform } from "../../../types/index.ts";
import type { BaseWizardContext } from "../../types.ts";
import { validateDeviceInfo, WIZARD_TIMEOUTS } from "../../utils.ts";
import { createWebOSConnection, type WebOSConnection } from "../connection.ts";
import { createCredentials, type WebOSCredentials } from "../credentials.ts";

export interface WizardInput {
  deviceName?: string;
  deviceIp?: string;
}

export interface WizardOutput {
  deviceName: string;
  deviceIp: string;
  platform: TVPlatform;
  credentials: unknown;
}

interface WebOSWizardContext extends BaseWizardContext {
  connection: WebOSConnection | null;
  credentials: WebOSCredentials | null;
}

type WebOSWizardEvent =
  | { type: "CHAR_INPUT"; char: string }
  | { type: "BACKSPACE" }
  | { type: "TAB" }
  | { type: "SUBMIT" }
  | { type: "CANCEL" }
  | { type: "RETRY" }
  | { type: "BACK" };

export const webOSWizardMachine = setup({
  types: {
    context: {} as WebOSWizardContext,
    events: {} as WebOSWizardEvent,
    input: {} as WizardInput,
    output: {} as WizardOutput,
  },
  actors: {
    initiateConnection: fromPromise(async ({ input }: { input: { ip: string } }) => {
      const connection = createWebOSConnection({
        ip: input.ip,
        mac: "",
        timeout: 30000,
        reconnect: 0,
      });
      await connection.connect();
      return { connection };
    }),
    checkPairingStatus: fromPromise(
      async ({
        input,
      }: {
        input: { connection: WebOSConnection };
      }): Promise<{ isPaired: boolean; clientKey?: string }> => {
        const isPaired = input.connection.isPaired();
        const clientKey = input.connection.getClientKey();
        return { isPaired: isPaired && !!clientKey, clientKey };
      },
    ),
  },
  delays: {
    connectionTimeout: WIZARD_TIMEOUTS.CONNECTION,
    pairingTimeout: WIZARD_TIMEOUTS.PAIRING,
  },
  actions: {
    appendToActiveField: assign({
      deviceName: ({ context, event }) =>
        context.activeField === "name" && event.type === "CHAR_INPUT"
          ? context.deviceName + event.char
          : context.deviceName,
      deviceIp: ({ context, event }) =>
        context.activeField === "ip" && event.type === "CHAR_INPUT"
          ? context.deviceIp + event.char
          : context.deviceIp,
      error: null,
    }),
    backspaceActiveField: assign({
      deviceName: ({ context }) =>
        context.activeField === "name" ? context.deviceName.slice(0, -1) : context.deviceName,
      deviceIp: ({ context }) =>
        context.activeField === "ip" ? context.deviceIp.slice(0, -1) : context.deviceIp,
      error: null,
    }),
    toggleField: assign({
      activeField: ({ context }) =>
        (context.activeField === "name" ? "ip" : "name") as "name" | "ip",
    }),
    setError: assign({
      error: (_, params: { error: string }) => params.error,
    }),
    clearError: assign({ error: null }),
    cleanupConnection: ({ context }) => {
      context.connection?.disconnect();
    },
    // Placeholder actions - provided by component
    onComplete: () => {},
    onCancel: () => {},
  },
  guards: {
    hasValidDeviceInfo: ({ context }) =>
      validateDeviceInfo(context.deviceName, context.deviceIp) === null,
  },
}).createMachine({
  id: "webOSWizard",
  initial: "deviceInfo",
  context: ({ input }) => ({
    deviceName: input.deviceName ?? "",
    deviceIp: input.deviceIp ?? "",
    activeField: "name" as const,
    error: null,
    connection: null,
    credentials: null,
  }),
  output: ({ context }) => ({
    deviceName: context.deviceName,
    deviceIp: context.deviceIp,
    platform: "lg-webos" as const,
    credentials: context.credentials,
  }),
  states: {
    deviceInfo: {
      on: {
        CHAR_INPUT: { actions: "appendToActiveField" },
        BACKSPACE: { actions: "backspaceActiveField" },
        TAB: { actions: "toggleField" },
        SUBMIT: [
          { guard: "hasValidDeviceInfo", target: "connecting" },
          {
            actions: assign({
              error: ({ context }) => validateDeviceInfo(context.deviceName, context.deviceIp),
            }),
          },
        ],
        CANCEL: "cancelled",
      },
    },
    connecting: {
      invoke: {
        src: "initiateConnection",
        input: ({ context }) => ({ ip: context.deviceIp }),
        onDone: {
          target: "awaitingConfirmation",
          actions: assign({ connection: ({ event }) => event.output.connection }),
        },
        onError: {
          target: "error",
          actions: assign({ error: ({ event }) => String(event.error) }),
        },
      },
      after: {
        connectionTimeout: {
          target: "error",
          actions: assign({
            error: "Connection timeout. Please check if the TV is on and reachable.",
          }),
        },
      },
      on: {
        CANCEL: { target: "cancelled", actions: "cleanupConnection" },
      },
    },
    awaitingConfirmation: {
      on: {
        SUBMIT: "checkingStatus",
        BACK: { target: "deviceInfo", actions: "cleanupConnection" },
        CANCEL: { target: "cancelled", actions: "cleanupConnection" },
      },
    },
    checkingStatus: {
      invoke: {
        src: "checkPairingStatus",
        input: ({ context }) => {
          if (!context.connection) throw new Error("Connection not established");
          return { connection: context.connection };
        },
        onDone: [
          {
            guard: ({ event }) => event.output.isPaired && !!event.output.clientKey,
            target: "complete",
            actions: assign({
              credentials: ({ context, event }) =>
                createCredentials(
                  event.output.clientKey as string,
                  "",
                  context.connection?.isSslEnabled(),
                ),
            }),
          },
          {
            target: "awaitingConfirmation",
            actions: assign({
              error: () => "Please confirm the pairing request on your TV, then press Enter.",
            }),
          },
        ],
        onError: {
          target: "error",
          actions: assign({ error: ({ event }) => String(event.error) }),
        },
      },
      after: {
        pairingTimeout: {
          target: "awaitingConfirmation",
          actions: assign({
            error: "Pairing check timeout. Please confirm the pairing request on your TV, then press Enter.",
          }),
        },
      },
    },
    error: {
      on: {
        RETRY: {
          target: "connecting",
          actions: [
            "cleanupConnection",
            assign({ error: null, connection: null, credentials: null }),
          ],
        },
        BACK: {
          target: "deviceInfo",
          actions: ["cleanupConnection", "clearError"],
        },
        CANCEL: { target: "cancelled", actions: "cleanupConnection" },
      },
    },
    complete: {
      type: "final",
      entry: "onComplete",
    },
    cancelled: {
      type: "final",
      entry: ["cleanupConnection", "onCancel"],
    },
  },
});

export type WebOSWizardSnapshot = ReturnType<typeof webOSWizardMachine.getInitialSnapshot>;
