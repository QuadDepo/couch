import type { TVDevice } from "../../types";
import type { DeviceHandler, CommandResult } from "../types";
import { createStatusManager, createKeySender, createPairingManager } from "../utils";
import { keymap } from "./keymap";
import { capabilities } from "./capabilities";
import { pairingSteps } from "./pairing";
import { createADBConnection } from "./connection";
import { sendWakeOnLan } from "./wol";

export function createAndroidTVHandler(device: TVDevice): DeviceHandler {
  const statusManager = createStatusManager();
  const pairingManager = createPairingManager(pairingSteps);
  const adb = createADBConnection(device.ip);

  const sendPlatformKey = async (keyCode: string | number): Promise<CommandResult> => {
    const start = Date.now();
    try {
      await adb.sendKeyEvent(String(keyCode));
      return { success: true, latencyMs: Date.now() - start };
    } catch (error) {
      return { success: false, error: String(error), latencyMs: Date.now() - start };
    }
  };

  const sendKey = createKeySender(keymap, capabilities, sendPlatformKey);

  return {
    platform: "android-tv",
    device,
    capabilities,

    getStatus: statusManager.getStatus,
    onStatusChange: statusManager.onStatusChange,

    async connect() {
      statusManager.setStatus("connecting");
      try {
        if (device.mac) {
          await sendWakeOnLan(device.mac);
        }
        await adb.connect();
        statusManager.setStatus("connected");
      } catch (error) {
        statusManager.setStatus("error");
        throw error;
      }
    },

    async disconnect() {
      await adb.disconnect();
      statusManager.setStatus("disconnected");
    },

    sendKey,
    isKeySupported: (key) => capabilities.supportedKeys.has(key),

    async startPairing() {
      statusManager.setStatus("pairing");
      return pairingManager.start();
    },

    async submitPairingInput(stepId, input) {
      const state = await pairingManager.submitInput(stepId, input);

      if (state.isComplete) {
        const port = state.inputs["enter_pairing_port"] ?? "";
        const code = state.inputs["enter_pairing_code"] ?? "";
        try {
          await adb.pair(port, code);
          await adb.connect();
          statusManager.setStatus("connected");
        } catch {
          statusManager.setStatus("error");
          return { ...state, error: "Pairing failed" };
        }
      }

      return state;
    },

    async cancelPairing() {
      await pairingManager.cancel();
      statusManager.setStatus("disconnected");
    },

    dispose() {
      adb.disconnect();
      statusManager.clearListeners();
    },
  };
}
