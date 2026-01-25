import type {
  CommandResult,
  ConnectionStatus,
  DeviceCapabilities,
  KeyMap,
  PairingState,
  PairingStep,
  RemoteKey,
} from "./types";

export function createStatusManager() {
  let status: ConnectionStatus = "disconnected";
  const listeners = new Set<(status: ConnectionStatus) => void>();

  return {
    getStatus: () => status,
    setStatus: (newStatus: ConnectionStatus) => {
      status = newStatus;
      for (const cb of listeners) {
        cb(status);
      }
    },
    onStatusChange: (cb: (status: ConnectionStatus) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    clearListeners: () => listeners.clear(),
  };
}

export function createKeySender(
  keyMap: KeyMap,
  capabilities: DeviceCapabilities,
  sendPlatformKey: (code: string | number) => Promise<CommandResult>,
) {
  return async (key: RemoteKey): Promise<CommandResult> => {
    if (!capabilities.supportedKeys.has(key)) {
      return { success: false, error: `Key ${key} not supported` };
    }
    const platformKey = keyMap[key];
    if (!platformKey) {
      return { success: false, error: `No mapping for ${key}` };
    }
    return sendPlatformKey(platformKey);
  };
}

export function createPairingManager(steps: PairingStep[]) {
  let state: PairingState | null = null;
  let onCancel: (() => void) | null = null;

  const getCurrentState = (): PairingState => {
    if (!state) throw new Error("Pairing not started");
    return state;
  };

  return {
    start: async (): Promise<PairingState> => {
      if (steps.length === 0) {
        throw new Error("No pairing steps defined");
      }
      state = {
        currentStep: steps[0]!,
        stepIndex: 0,
        totalSteps: steps.length,
        inputs: {},
        isComplete: false,
      };
      return state!;
    },

    submitInput: async (stepId: string, input: string): Promise<PairingState> => {
      const current = getCurrentState();
      if (current.currentStep.id !== stepId) {
        return { ...current, error: `Unexpected step ${stepId}` };
      }

      current.inputs[stepId] = input;
      const nextIndex = current.stepIndex + 1;

      if (nextIndex >= steps.length) {
        state = { ...current, isComplete: true };
      } else {
        state = {
          ...current,
          currentStep: steps[nextIndex]!,
          stepIndex: nextIndex,
          error: undefined,
        };
      }
      return state!;
    },

    cancel: async (): Promise<void> => {
      onCancel?.();
      state = null;
    },

    setOnCancel: (cb: () => void) => {
      onCancel = cb;
    },

    getState: () => state,
  };
}
