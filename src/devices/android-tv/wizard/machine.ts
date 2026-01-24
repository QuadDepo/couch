import { assign, fromPromise, setup } from "xstate";
import type { TVPlatform } from "../../../types/index.ts";
import { isValidIp } from "../../../utils/network.ts";
import type { BaseWizardContext } from "../../types.ts";
import { createADBConnection } from "../connection.ts";

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

export const androidTVInstructions = [
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

interface AndroidTVWizardContext extends BaseWizardContext {
  instructionStep: number;
}

type AndroidTVWizardEvent =
  | { type: "CHAR_INPUT"; char: string }
  | { type: "BACKSPACE" }
  | { type: "TAB" }
  | { type: "SUBMIT" }
  | { type: "CANCEL" }
  | { type: "RETRY" }
  | { type: "BACK" };

export const androidTVWizardMachine = setup({
  types: {
    context: {} as AndroidTVWizardContext,
    events: {} as AndroidTVWizardEvent,
    input: {} as WizardInput,
    output: {} as WizardOutput,
  },
  actors: {
    connectADB: fromPromise(async ({ input }: { input: { ip: string } }) => {
      const adb = createADBConnection(input.ip);
      await adb.connect();
    }),
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
    nextInstruction: assign({
      instructionStep: ({ context }) => context.instructionStep + 1,
    }),
    resetInstructions: assign({
      instructionStep: 0,
    }),
    // Placeholder actions - provided by component
    onComplete: () => {},
    onCancel: () => {},
  },
  guards: {
    hasValidDeviceInfo: ({ context }) =>
      context.deviceName.trim().length > 0 && isValidIp(context.deviceIp),
    missingName: ({ context }) => context.deviceName.trim().length === 0,
    invalidIp: ({ context }) => !isValidIp(context.deviceIp),
    hasMoreInstructions: ({ context }) =>
      context.instructionStep < androidTVInstructions.length - 1,
  },
}).createMachine({
  id: "androidTVWizard",
  initial: "deviceInfo",
  context: ({ input }) => ({
    deviceName: input.deviceName ?? "",
    deviceIp: input.deviceIp ?? "",
    activeField: "name" as const,
    error: null,
    instructionStep: 0,
  }),
  output: ({ context }) => ({
    deviceName: context.deviceName,
    deviceIp: context.deviceIp,
    platform: "android-tv" as const,
    credentials: null,
  }),
  states: {
    deviceInfo: {
      on: {
        CHAR_INPUT: { actions: "appendToActiveField" },
        BACKSPACE: { actions: "backspaceActiveField" },
        TAB: { actions: "toggleField" },
        SUBMIT: [
          { guard: "hasValidDeviceInfo", target: "showingInstructions" },
          {
            guard: "missingName",
            actions: { type: "setError", params: { error: "Device name is required" } },
          },
          {
            guard: "invalidIp",
            actions: { type: "setError", params: { error: "Invalid IP address" } },
          },
        ],
        CANCEL: "cancelled",
      },
    },
    showingInstructions: {
      on: {
        SUBMIT: [
          { guard: "hasMoreInstructions", actions: "nextInstruction" },
          { target: "connecting" },
        ],
        BACK: {
          target: "deviceInfo",
          actions: "resetInstructions",
        },
        CANCEL: "cancelled",
      },
    },
    connecting: {
      invoke: {
        src: "connectADB",
        input: ({ context }) => ({ ip: context.deviceIp }),
        onDone: { target: "complete" },
        onError: {
          target: "error",
          actions: assign({ error: ({ event }) => String(event.error) }),
        },
      },
      on: {
        CANCEL: "cancelled",
      },
    },
    error: {
      on: {
        RETRY: {
          target: "connecting",
          actions: "clearError",
        },
        BACK: {
          target: "showingInstructions",
          actions: ["clearError", "resetInstructions"],
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

export type AndroidTVWizardSnapshot = ReturnType<typeof androidTVWizardMachine.getInitialSnapshot>;
