import { type Actor, assign, type SnapshotFrom } from "xstate";
import {
  createDeviceMachine,
  type DeviceLoadInput,
  type PlatformInput,
} from "../../shared/machine";
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

export type AndroidTVSetupInput = PlatformInput<"android-tv">;

export type AndroidTVLoadInput = DeviceLoadInput<"android-tv">;

export type AndroidTVMachineInput = AndroidTVSetupInput | AndroidTVLoadInput;

// ADB has no credentials; the pairing wizard adds instruction-navigation events.
type AndroidTVPlatformEvent =
  | { type: "CONTINUE_INSTRUCTION" }
  | { type: "BACK_INSTRUCTION" }
  | { type: "PAIRED" };

interface AndroidTVExtraContext extends Record<string, unknown> {
  instructionStep: number;
}

export const androidTVDeviceMachine = createDeviceMachine<
  AndroidTVMachineInput,
  Record<never, never>,
  AndroidTVPlatformEvent,
  AndroidTVExtraContext,
  typeof pairingActor,
  typeof sessionActor
>({
  id: "androidTVDevice",
  logCategory: "ADB",
  credentials: null,
  extraContext: () => ({ instructionStep: 0 }),
  extraContextOnReset: { instructionStep: 0 },
  extraActions: {
    nextInstructionStep: assign({
      instructionStep: ({ context }: { context: AndroidTVExtraContext }) =>
        context.instructionStep + 1,
    }),
    prevInstructionStep: assign({
      instructionStep: ({ context }: { context: AndroidTVExtraContext }) =>
        context.instructionStep - 1,
    }),
    resetInstructionStep: assign({
      instructionStep: 0,
    }),
  },
  extraGuards: {
    hasMoreInstructionSteps: ({ context }: { context: AndroidTVExtraContext }) =>
      context.instructionStep < INSTRUCTION_STEPS.length - 1,
    canGoBackInInstructions: ({ context }: { context: AndroidTVExtraContext }) =>
      context.instructionStep > 0,
  },
  pairing: {
    logic: pairingActor,
    input: (context) => ({ ip: context.deviceIp }),
    promptTarget: "waitingForUser",
    entryTarget: "instructions",
    startActions: ["resetInstructionStep"],
    extraStates: () => ({
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
                params: ({ context }: { context: { deviceName: string } }) => ({
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
    }),
    states: ({ userInputTimeout }) => ({
      waitingForUser: {
        after: { pairingUserInputTimeout: userInputTimeout },
      },
    }),
  },
  session: {
    logic: sessionActor,
    input: (context) => ({
      deviceId: context.deviceId ?? context.deviceIp,
      ip: context.deviceIp,
      deviceName: context.deviceName,
    }),
  },
});

export type AndroidTVDeviceMachine = typeof androidTVDeviceMachine;
export type AndroidTVDeviceMachineActor = Actor<AndroidTVDeviceMachine>;
export type AndroidTVDeviceMachineSnapshot = SnapshotFrom<typeof androidTVDeviceMachine>;
