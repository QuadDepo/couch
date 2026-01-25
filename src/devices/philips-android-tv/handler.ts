import type { TVDevice } from "../../types";
import type { CommandResult, DeviceHandler } from "../types";
import { createKeySender, createStatusManager } from "../utils";
import { capabilities } from "./capabilities";
import { createPhilipsConnection } from "./connection";
import { type PhilipsCredentials, validatePhilipsCredentials } from "./credentials";
import { keymap } from "./keymap";

export function createPhilipsAndroidTVHandler(device: TVDevice): DeviceHandler {
  const statusManager = createStatusManager();

  let initialCredentials: PhilipsCredentials | undefined;

  const config = (device as TVDevice<"philips-android-tv">).config;

  if (config?.philips) {
    try {
      initialCredentials = validatePhilipsCredentials(config.philips);
    } catch {
      initialCredentials = undefined;
    }
  }

  const connection = createPhilipsConnection(device.ip, initialCredentials);

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

    dispose() {
      statusManager.clearListeners();
    },
  };
}
