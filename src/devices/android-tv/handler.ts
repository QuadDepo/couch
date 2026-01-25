import type { TVDevice } from "../../types";
import type { CommandResult, DeviceHandler } from "../types";
import { createKeySender, createStatusManager } from "../utils";
import { capabilities } from "./capabilities";
import { createADBConnection } from "./connection";
import { keymap } from "./keymap";

export function createAndroidTVHandler(device: TVDevice): DeviceHandler {
  const statusManager = createStatusManager();
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

    async sendText(text: string) {
      const start = Date.now();
      try {
        await adb.sendText(text);
        return { success: true, latencyMs: Date.now() - start };
      } catch (error) {
        return { success: false, error: String(error), latencyMs: Date.now() - start };
      }
    },

    dispose() {
      adb.disconnect();
      statusManager.clearListeners();
    },
  };
}
