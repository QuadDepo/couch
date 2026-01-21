import type { TVDevice } from "../../types";
import type { CommandResult, DeviceHandler, PairingState } from "../types";
import { createKeySender, createStatusManager } from "../utils";
import { capabilities } from "./capabilities";
import { createPhilipsConnection } from "./connection";
import { type PhilipsCredentials, validatePhilipsCredentials } from "./credentials";
import { keymap } from "./keymap";
import { pairingSteps } from "./pairing";

export function createPhilipsAndroidTVHandler(device: TVDevice): DeviceHandler {
  const statusManager = createStatusManager();

  let initialCredentials: PhilipsCredentials | undefined;
  if (device.config?.philips) {
    try {
      initialCredentials = validatePhilipsCredentials(device.config.philips);
    } catch {
      initialCredentials = undefined;
    }
  }

  const connection = createPhilipsConnection(device.ip, initialCredentials);

  let pairingData: { authKey: string; timestamp: number; deviceId: string } | null = null;
  let currentPairingStepIndex = 0;

  const sendPlatformKey = async (keyCode: string | number): Promise<CommandResult> => {
    const start = Date.now();
    try {
      await connection.request("POST", "/input/key", { key: String(keyCode) });
      return { success: true, latencyMs: Date.now() - start };
    } catch (error) {
      return { success: false, error: String(error), latencyMs: Date.now() - start };
    }
  };

  const sendKey = createKeySender(keymap, capabilities, sendPlatformKey);

  return {
    platform: "philips-android-tv",
    device,
    capabilities,

    getStatus: statusManager.getStatus,
    onStatusChange: statusManager.onStatusChange,

    async connect() {
      statusManager.setStatus("connecting");

      // Credentials are set during handler initialization
      // Verify we have valid credentials before attempting connection
      if (!connection.hasCredentials()) {
        statusManager.setStatus("error");
        throw new Error("Philips TV requires pairing. Please pair first.");
      }

      try {
        const powerState = await connection.request<{ powerstate: string }>("GET", "/powerstate");

        if (powerState.powerstate === "Standby") {
          await connection.request("POST", "/powerstate", { powerstate: "On" });
        }

        statusManager.setStatus("connected");
      } catch (error) {
        statusManager.setStatus("error");
        throw error;
      }
    },

    async disconnect() {
      statusManager.setStatus("disconnected");
    },

    sendKey,
    isKeySupported: (key) => capabilities.supportedKeys.has(key),

    async sendText(_text: string) {
      return { success: false, error: "Text input is not supported on this device" };
    },

    async startPairing(): Promise<PairingState> {
      statusManager.setStatus("pairing");
      currentPairingStepIndex = 0;

      try {
        pairingData = await connection.startPairing("BaghdadRemote");
        currentPairingStepIndex = 1;

        return {
          currentStep: pairingSteps[1]!,
          stepIndex: 1,
          totalSteps: pairingSteps.length,
          inputs: {},
          isComplete: false,
        };
      } catch (error) {
        statusManager.setStatus("error");
        return {
          currentStep: pairingSteps[0]!,
          stepIndex: 0,
          totalSteps: pairingSteps.length,
          inputs: {},
          error: String(error),
          isComplete: false,
        };
      }
    },

    async submitPairingInput(stepId: string, input: string): Promise<PairingState> {
      if (stepId === "enter_pin" && pairingData) {
        try {
          const credentials = await connection.confirmPairing(
            input,
            pairingData.authKey,
            pairingData.timestamp,
            pairingData.deviceId,
            "BaghdadRemote",
          );

          currentPairingStepIndex = 2;
          statusManager.setStatus("disconnected");

          return {
            currentStep: pairingSteps[2]!,
            stepIndex: 2,
            totalSteps: pairingSteps.length,
            inputs: { enter_pin: input },
            isComplete: true,
            credentials,
          };
        } catch (error) {
          return {
            currentStep: pairingSteps[1]!,
            stepIndex: 1,
            totalSteps: pairingSteps.length,
            inputs: {},
            error: `Pairing failed: ${error}`,
            isComplete: false,
          };
        }
      }

      return {
        currentStep: pairingSteps[currentPairingStepIndex]!,
        stepIndex: currentPairingStepIndex,
        totalSteps: pairingSteps.length,
        inputs: {},
        isComplete: false,
      };
    },

    async cancelPairing() {
      pairingData = null;
      currentPairingStepIndex = 0;
      statusManager.setStatus("disconnected");
    },

    dispose() {
      statusManager.clearListeners();
    },
  };
}
