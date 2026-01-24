import { assign, fromPromise, setup } from "xstate";
import type { TVPlatform } from "../../../types/index.ts";
import type { BaseWizardContext } from "../../types.ts";
import { validateDeviceInfo, WIZARD_TIMEOUTS } from "../../utils.ts";
import { createPhilipsConnection } from "../connection.ts";
import type { PhilipsCredentials } from "../credentials.ts";

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

interface PairingData {
  authKey: string;
  timestamp: number;
  deviceId: string;
}

interface PhilipsWizardContext extends BaseWizardContext {
  pin: string;
  pairingData: PairingData | null;
  credentials: PhilipsCredentials | null;
}

type PhilipsWizardEvent =
  | { type: "CHAR_INPUT"; char: string }
  | { type: "BACKSPACE" }
  | { type: "TAB" }
  | { type: "SUBMIT" }
  | { type: "CANCEL" }
  | { type: "RETRY" }
  | { type: "BACK" };

export const philipsWizardMachine = setup({
  types: {
    context: {} as PhilipsWizardContext,
    events: {} as PhilipsWizardEvent,
    input: {} as WizardInput,
    output: {} as WizardOutput,
  },
  actors: {
    requestPin: fromPromise(async ({ input }: { input: { ip: string } }) => {
      const connection = createPhilipsConnection(input.ip);
      const pairingData = await connection.startPairing("CouchRemote");
      return { pairingData };
    }),
    validatePin: fromPromise(
      async ({
        input,
      }: {
        input: { ip: string; pin: string; pairingData: PairingData };
      }): Promise<PhilipsCredentials> => {
        const connection = createPhilipsConnection(input.ip);
        return await connection.confirmPairing(
          input.pin,
          input.pairingData.authKey,
          input.pairingData.timestamp,
          input.pairingData.deviceId,
          "CouchRemote",
        );
      },
    ),
  },
  delays: {
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
    appendToPin: assign({
      pin: ({ context, event }) => {
        if (context.pin.length >= 4) return context.pin;
        if (event.type !== "CHAR_INPUT") return context.pin;
        if (!/^\d$/.test(event.char)) return context.pin;
        return context.pin + event.char;
      },
      error: null,
    }),
    backspacePin: assign({
      pin: ({ context }) => context.pin.slice(0, -1),
      error: null,
    }),
    clearPin: assign({ pin: "" }),
    // Placeholder actions - provided by component
    onComplete: () => {},
    onCancel: () => {},
  },
  guards: {
    hasValidDeviceInfo: ({ context }) =>
      validateDeviceInfo(context.deviceName, context.deviceIp) === null,
    hasValidPin: ({ context }) => context.pin.length === 4,
  },
}).createMachine({
  id: "philipsWizard",
  initial: "deviceInfo",
  context: ({ input }) => ({
    deviceName: input.deviceName ?? "",
    deviceIp: input.deviceIp ?? "",
    activeField: "name" as const,
    error: null,
    pin: "",
    pairingData: null,
    credentials: null,
  }),
  output: ({ context }) => ({
    deviceName: context.deviceName,
    deviceIp: context.deviceIp,
    platform: "philips-android-tv" as const,
    credentials: context.credentials,
  }),
  states: {
    deviceInfo: {
      on: {
        CHAR_INPUT: { actions: "appendToActiveField" },
        BACKSPACE: { actions: "backspaceActiveField" },
        TAB: { actions: "toggleField" },
        SUBMIT: [
          { guard: "hasValidDeviceInfo", target: "requestingPin" },
          {
            actions: assign({
              error: ({ context }) => validateDeviceInfo(context.deviceName, context.deviceIp),
            }),
          },
        ],
        CANCEL: "cancelled",
      },
    },
    requestingPin: {
      invoke: {
        src: "requestPin",
        input: ({ context }) => ({ ip: context.deviceIp }),
        onDone: {
          target: "enteringPin",
          actions: assign({ pairingData: ({ event }) => event.output.pairingData }),
        },
        onError: {
          target: "error",
          actions: assign({ error: ({ event }) => String(event.error) }),
        },
      },
      after: {
        pairingTimeout: {
          target: "error",
          actions: assign({
            error: "Pairing request timeout. Please check if the TV is on and reachable.",
          }),
        },
      },
      on: {
        CANCEL: "cancelled",
      },
    },
    enteringPin: {
      on: {
        CHAR_INPUT: { actions: "appendToPin" },
        BACKSPACE: { actions: "backspacePin" },
        SUBMIT: { guard: "hasValidPin", target: "validatingPin" },
        BACK: {
          target: "deviceInfo",
          actions: ["clearPin", assign({ pairingData: null })],
        },
        CANCEL: "cancelled",
      },
    },
    validatingPin: {
      invoke: {
        src: "validatePin",
        input: ({ context }) => {
          if (!context.pairingData) throw new Error("Pairing data not available");
          return {
            ip: context.deviceIp,
            pin: context.pin,
            pairingData: context.pairingData,
          };
        },
        onDone: {
          target: "complete",
          actions: assign({ credentials: ({ event }) => event.output }),
        },
        onError: {
          target: "pinError",
          actions: [assign({ error: () => "Invalid PIN. Please try again." }), "clearPin"],
        },
      },
      after: {
        pairingTimeout: {
          target: "pinError",
          actions: assign({
            error: "PIN validation timeout. Please try again.",
          }),
        },
      },
    },
    pinError: {
      on: {
        CHAR_INPUT: {
          target: "enteringPin",
          actions: [
            "clearError",
            assign({
              pin: ({ event }) => {
                if (event.type !== "CHAR_INPUT") return "";
                if (!/^\d$/.test(event.char)) return "";
                return event.char;
              },
            }),
          ],
        },
        RETRY: {
          target: "requestingPin",
          actions: ["clearPin", "clearError", assign({ pairingData: null })],
        },
        BACK: {
          target: "deviceInfo",
          actions: ["clearPin", "clearError", assign({ pairingData: null })],
        },
        CANCEL: "cancelled",
      },
    },
    error: {
      on: {
        RETRY: {
          target: "requestingPin",
          actions: ["clearPin", "clearError", assign({ pairingData: null })],
        },
        BACK: {
          target: "deviceInfo",
          actions: ["clearError"],
        },
        CANCEL: "cancelled",
      },
    },
    complete: {
      type: "final",
      entry: "onComplete",
    },
    cancelled: {
      type: "final",
      entry: "onCancel",
    },
  },
});

export type PhilipsWizardSnapshot = ReturnType<typeof philipsWizardMachine.getInitialSnapshot>;
