import { setup, assign, fromPromise, Actor } from "xstate";
import type { TVPlatform } from "../types/index.ts";
import type { PairingStep } from "../devices/types.ts";
import { implementedPlatforms } from "../devices/factory.ts";
import { pairingSteps as androidTVPairingSteps } from "../devices/android-tv/pairing.ts";
import { pairingSteps as philipsPairingSteps } from "../devices/philips-android-tv/pairing.ts";

export { implementedPlatforms };

export interface WizardContext {
  platform: TVPlatform | null;
  selectedPlatformIndex: number;
  deviceName: string;
  deviceIp: string;
  activeField: "name" | "ip";
  pairingSteps: PairingStep[];
  currentStepIndex: number;
  pairingInputs: Record<string, string>;
  currentInput: string;
  credentials: unknown;
  error?: string;
  actionSuccess?: boolean;
}

type WizardEvent =
  | { type: "ARROW_UP" }
  | { type: "ARROW_DOWN" }
  | { type: "SELECT" }
  | { type: "CHAR_INPUT"; char: string }
  | { type: "BACKSPACE" }
  | { type: "TAB" }
  | { type: "SUBMIT" }
  | { type: "BACK" }
  | { type: "CANCEL" }
  | { type: "PAIRING_COMPLETE"; credentials: unknown }
  | { type: "PAIRING_ERROR"; error: string }
  | { type: "NEXT_STEP" }
  | { type: "DONE" };

function getPairingStepsForPlatform(platform: TVPlatform): PairingStep[] {
  switch (platform) {
    case "android-tv":
      return androidTVPairingSteps;
    case "philips-android-tv":
      return philipsPairingSteps;
    default:
      return [];
  }
}

function isValidIpAddress(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const num = parseInt(part, 10);
    return !isNaN(num) && num >= 0 && num <= 255 && part === String(num);
  });
}

export interface PairingActionInput {
  stepId: string;
  platform: TVPlatform;
  deviceIp: string;
  deviceName: string;
}

export interface PairingActionResult {
  credentials?: unknown;
  error?: string;
}

export interface SubmitPairingInputData {
  stepId: string;
  input: string;
}

export interface SubmitPairingInputResult {
  error?: string;
  isComplete?: boolean;
  credentials?: unknown;
}

export const addDeviceWizardMachine = setup({
  types: {
    context: {} as WizardContext,
    events: {} as WizardEvent,
  },
  actors: {
    executePairingAction: fromPromise<PairingActionResult, PairingActionInput>(
      async () => ({})
    ),
    submitPairingInput: fromPromise<SubmitPairingInputResult, SubmitPairingInputData>(
      async () => ({})
    ),
  },
  actions: {
    // Placeholder actions - provide implementations via machine.provide()
    onComplete: () => {},
    onCancel: () => {},
    selectPlatformUp: assign({
      selectedPlatformIndex: ({ context }) =>
        Math.max(0, context.selectedPlatformIndex - 1),
    }),
    selectPlatformDown: assign({
      selectedPlatformIndex: ({ context }) =>
        Math.min(
          implementedPlatforms.length - 1,
          context.selectedPlatformIndex + 1
        ),
    }),
    setPlatformFromSelection: assign({
      platform: ({ context }) =>
        implementedPlatforms[context.selectedPlatformIndex]?.id ?? null,
    }),
    appendToActiveField: assign({
      deviceName: ({ context, event }) => {
        if (context.activeField !== "name") return context.deviceName;
        const e = event as { type: "CHAR_INPUT"; char: string };
        return context.deviceName + e.char;
      },
      deviceIp: ({ context, event }) => {
        if (context.activeField !== "ip") return context.deviceIp;
        const e = event as { type: "CHAR_INPUT"; char: string };
        return context.deviceIp + e.char;
      },
      error: undefined,
    }),
    backspaceActiveField: assign({
      deviceName: ({ context }) => {
        if (context.activeField !== "name") return context.deviceName;
        return context.deviceName.slice(0, -1);
      },
      deviceIp: ({ context }) => {
        if (context.activeField !== "ip") return context.deviceIp;
        return context.deviceIp.slice(0, -1);
      },
      error: undefined,
    }),
    toggleActiveField: assign({
      activeField: ({ context }) =>
        context.activeField === "name" ? "ip" : "name",
    }),
    setValidationError: assign({
      error: (_, params: { error: string }) => params.error,
    }),
    clearError: assign({
      error: undefined,
    }),
    loadPairingSteps: assign({
      pairingSteps: ({ context }) =>
        context.platform ? getPairingStepsForPlatform(context.platform) : [],
      currentStepIndex: 0,
      currentInput: "",
    }),
    appendToCurrentInput: assign({
      currentInput: ({ context, event }) => {
        const e = event as { type: "CHAR_INPUT"; char: string };
        const currentStep = context.pairingSteps[context.currentStepIndex];
        if (currentStep?.inputType === "pin" && context.currentInput.length >= 6) {
          return context.currentInput;
        }
        return context.currentInput + e.char;
      },
    }),
    backspaceCurrentInput: assign({
      currentInput: ({ context }) => context.currentInput.slice(0, -1),
    }),
    recordPairingInput: assign({
      pairingInputs: ({ context }) => {
        const currentStep = context.pairingSteps[context.currentStepIndex];
        if (!currentStep) return context.pairingInputs;
        return {
          ...context.pairingInputs,
          [currentStep.id]: context.currentInput,
        };
      },
    }),
    advanceToNextStep: assign({
      currentStepIndex: ({ context }) => context.currentStepIndex + 1,
      currentInput: "",
    }),
    setCredentials: assign({
      credentials: (_, params: { credentials: unknown }) => params.credentials,
    }),
    setError: assign({
      error: (_, params: { error: string }) => params.error,
    }),
    setActionSuccess: assign({
      actionSuccess: true,
    }),
    clearActionSuccess: assign({
      actionSuccess: false,
    }),
    resetDeviceInfo: assign({
      deviceName: "",
      deviceIp: "",
      activeField: "name" as const,
      error: undefined,
    }),
  },
  guards: {
    hasValidDeviceInfo: ({ context }) =>
      context.deviceName.trim().length > 0 && isValidIpAddress(context.deviceIp),
    hasValidIp: ({ context }) => isValidIpAddress(context.deviceIp),
    hasDeviceName: ({ context }) => context.deviceName.trim().length > 0,
    missingDeviceName: ({ context }) => context.deviceName.trim().length === 0,
    hasInvalidIp: ({ context }) => !isValidIpAddress(context.deviceIp),
    hasMoreSteps: ({ context }) =>
      context.currentStepIndex < context.pairingSteps.length - 1,
    hasActionSuccess: ({ context }) => !!context.actionSuccess,
    hasActionSuccessWithCredentials: ({ context }) =>
      !!context.actionSuccess && !!context.credentials,
    hasActionSuccessWithMoreSteps: ({ context }) =>
      !!context.actionSuccess && context.currentStepIndex < context.pairingSteps.length - 1,
    isInputStep: ({ context }) => {
      const currentStep = context.pairingSteps[context.currentStepIndex];
      return currentStep?.type === "input";
    },
    isActionStep: ({ context }) => {
      const currentStep = context.pairingSteps[context.currentStepIndex];
      return currentStep?.type === "action";
    },
    isInfoStep: ({ context }) => {
      const currentStep = context.pairingSteps[context.currentStepIndex];
      return currentStep?.type === "info";
    },
    isWaitingStep: ({ context }) => {
      const currentStep = context.pairingSteps[context.currentStepIndex];
      return currentStep?.type === "waiting";
    },
    hasValidInput: ({ context }) => {
      const currentStep = context.pairingSteps[context.currentStepIndex];
      if (!currentStep || currentStep.type !== "input") return true;
      if (currentStep.inputType === "pin") {
        return context.currentInput.length >= 4;
      }
      return context.currentInput.trim().length > 0;
    },
    canAdvanceStep: ({ context }) => {
      const currentStep = context.pairingSteps[context.currentStepIndex];
      const hasMore = context.currentStepIndex < context.pairingSteps.length - 1;
      if (!currentStep || currentStep.type !== "input") return hasMore;
      if (currentStep.inputType === "pin") {
        return context.currentInput.length >= 4 && hasMore;
      }
      return context.currentInput.trim().length > 0 && hasMore;
    },
    canCompleteStep: ({ context }) => {
      const currentStep = context.pairingSteps[context.currentStepIndex];
      if (!currentStep || currentStep.type !== "input") return true;
      if (currentStep.inputType === "pin") {
        return context.currentInput.length >= 4;
      }
      return context.currentInput.trim().length > 0;
    },
  },
}).createMachine({
  id: "addDeviceWizard",
  initial: "platformSelection",
  context: {
    platform: null,
    selectedPlatformIndex: 0,
    deviceName: "",
    deviceIp: "",
    activeField: "name",
    pairingSteps: [],
    currentStepIndex: 0,
    pairingInputs: {},
    currentInput: "",
    credentials: null,
    error: undefined,
    actionSuccess: false,
  },
  states: {
    platformSelection: {
      on: {
        ARROW_UP: {
          actions: "selectPlatformUp",
        },
        ARROW_DOWN: {
          actions: "selectPlatformDown",
        },
        SELECT: {
          target: "deviceInfo",
          actions: ["setPlatformFromSelection", "loadPairingSteps"],
        },
        SUBMIT: {
          target: "deviceInfo",
          actions: ["setPlatformFromSelection", "loadPairingSteps"],
        },
        CANCEL: {
          target: "cancelled",
        },
      },
    },
    deviceInfo: {
      on: {
        CHAR_INPUT: {
          actions: "appendToActiveField",
        },
        BACKSPACE: {
          actions: "backspaceActiveField",
        },
        TAB: {
          actions: "toggleActiveField",
        },
        SUBMIT: [
          {
            guard: "hasValidDeviceInfo",
            target: "pairing",
          },
          {
            guard: "missingDeviceName",
            actions: {
              type: "setValidationError",
              params: { error: "Device name is required" },
            },
          },
          {
            guard: "hasInvalidIp",
            actions: {
              type: "setValidationError",
              params: { error: "Invalid IP address" },
            },
          },
        ],
        BACK: {
          target: "platformSelection",
          actions: "resetDeviceInfo",
        },
        CANCEL: {
          target: "cancelled",
        },
      },
    },
    pairing: {
      initial: "evaluating",
      on: {
        BACK: { target: "deviceInfo" },
        CANCEL: { target: "cancelled" },
      },
      states: {
        evaluating: {
          always: [
            { guard: "isActionStep", target: "executingAction" },
            { target: "awaitingUser" },
          ],
        },
        executingAction: {
          invoke: {
            src: "executePairingAction",
            input: ({ context }) => ({
              stepId: context.pairingSteps[context.currentStepIndex]?.id ?? "",
              platform: context.platform!,
              deviceIp: context.deviceIp,
              deviceName: context.deviceName,
            }),
            onDone: [
              {
                guard: ({ event }) => !!event.output.error,
                target: "#addDeviceWizard.error",
                actions: {
                  type: "setError",
                  params: ({ event }) => ({ error: event.output.error! }),
                },
              },
              {
                guard: ({ event }) => !!event.output.credentials,
                target: "awaitingUser",
                actions: [
                  {
                    type: "setCredentials",
                    params: ({ event }) => ({ credentials: event.output.credentials }),
                  },
                  "setActionSuccess",
                ],
              },
              {
                target: "awaitingUser",
                actions: "setActionSuccess",
              },
            ],
            onError: {
              target: "#addDeviceWizard.error",
              actions: {
                type: "setError",
                params: ({ event }) => ({ error: String(event.error) }),
              },
            },
          },
        },
        awaitingUser: {
          on: {
            CHAR_INPUT: {
              guard: "isInputStep",
              actions: "appendToCurrentInput",
            },
            BACKSPACE: {
              guard: "isInputStep",
              actions: "backspaceCurrentInput",
            },
            SUBMIT: [
              // Action completed with credentials - go to complete
              {
                guard: "hasActionSuccessWithCredentials",
                target: "#addDeviceWizard.complete",
                actions: "clearActionSuccess",
              },
              // Action completed, more steps to go
              {
                guard: "hasActionSuccessWithMoreSteps",
                target: "evaluating",
                actions: ["clearActionSuccess", "advanceToNextStep"],
              },
              // Action completed, no more steps
              {
                guard: "hasActionSuccess",
                target: "#addDeviceWizard.complete",
                actions: "clearActionSuccess",
              },
              // Input steps need to submit to device handler first
              {
                guard: { type: "isInputStep", params: {} },
                target: "submittingInput",
                actions: "recordPairingInput",
              },
              // Non-input steps can advance directly
              {
                guard: "hasMoreSteps",
                target: "evaluating",
                actions: "advanceToNextStep",
              },
              { target: "#addDeviceWizard.complete" },
            ],
          },
        },
        submittingInput: {
          invoke: {
            src: "submitPairingInput",
            input: ({ context }) => ({
              stepId: context.pairingSteps[context.currentStepIndex]?.id ?? "",
              input: context.currentInput,
            }),
            onDone: [
              {
                guard: ({ event }) => !!event.output.error,
                target: "#addDeviceWizard.error",
                actions: {
                  type: "setError",
                  params: ({ event }) => ({ error: event.output.error! }),
                },
              },
              {
                guard: ({ event }) => !!event.output.isComplete && !!event.output.credentials,
                target: "#addDeviceWizard.complete",
                actions: {
                  type: "setCredentials",
                  params: ({ event }) => ({ credentials: event.output.credentials }),
                },
              },
              {
                guard: "hasMoreSteps",
                target: "evaluating",
                actions: "advanceToNextStep",
              },
              { target: "#addDeviceWizard.complete" },
            ],
            onError: {
              target: "#addDeviceWizard.error",
              actions: {
                type: "setError",
                params: ({ event }) => ({ error: String(event.error) }),
              },
            },
          },
        },
      },
    },
    complete: {
      on: {
        SUBMIT: {
          target: "done",
        },
        SELECT: {
          target: "done",
        },
        DONE: {
          target: "done",
        },
      },
    },
    error: {
      on: {
        BACK: {
          target: "deviceInfo",
          actions: "clearError",
        },
        CANCEL: {
          target: "cancelled",
        },
      },
    },
    cancelled: {
      type: "final",
      entry: "onCancel",
    },
    done: {
      type: "final",
      entry: "onComplete",
    },
  },
});


export type WizardActorRef = Actor<typeof addDeviceWizardMachine>;