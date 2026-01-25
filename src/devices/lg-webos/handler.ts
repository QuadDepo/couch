import type { TVDevice } from "../../types";
import { logger } from "../../utils/logger";
import type { CommandResult, DeviceHandler, PairingState } from "../types";
import { createKeySender, createStatusManager } from "../utils";
import { capabilities } from "./capabilities";
import type { RemoteInputSocket } from "./connection";
import { createWebOSConnection } from "./connection";
import type { WebOSCredentials } from "./credentials";
import { createCredentials, validateWebOSCredentials } from "./credentials";
import { getInputSocketCommand, isInputSocketKey, keymap } from "./keymap";
import { pairingSteps } from "./pairing";
import { URI_INSERT_TEXT, URI_SET_MUTE } from "./protocol";

export function createWebOSHandler(device: TVDevice): DeviceHandler {
  const statusManager = createStatusManager();

  let initialCredentials: WebOSCredentials | undefined;
  const webosConfig = device.config as { webos?: unknown } | undefined;
  if (webosConfig?.webos) {
    try {
      initialCredentials = validateWebOSCredentials(webosConfig.webos);
    } catch {
      initialCredentials = undefined;
    }
  }

  // File-based key loading handled in connection layer to avoid top-level await
  let connection = createWebOSConnection({
    ip: device.ip,
    mac: device.mac || "",
    clientKey: initialCredentials?.clientKey,
    timeout: 15000,
    reconnect: 5000,
  });

  let inputSocket: RemoteInputSocket | null = null;
  let currentMuteState = false;
  let pairingInProgress = false;

  function checkPairingStatus(): { isPaired: boolean; clientKey?: string } {
    const isPaired = connection.isPaired();
    const clientKey = connection.getClientKey();
    logger.info("WebOS", `Checking pairing status - isPaired: ${isPaired}, hasKey: ${!!clientKey}`);
    return { isPaired: isPaired && !!clientKey, clientKey };
  }

  const sendPlatformKey = async (keyCode: string | number): Promise<CommandResult> => {
    const start = Date.now();

    try {
      if (isInputSocketKey(String(keyCode))) {
        if (!inputSocket) {
          inputSocket = await connection.getInputSocket();
        }
        const command = getInputSocketCommand(keyCode);
        inputSocket.send("button", { name: command });
      } else if (String(keyCode) === URI_SET_MUTE) {
        // WebOS mute is toggle-based; track state to send correct value
        await connection.request(String(keyCode), { mute: !currentMuteState });
        currentMuteState = !currentMuteState;
      } else {
        await connection.request(String(keyCode), {});
      }
      return { success: true, latencyMs: Date.now() - start };
    } catch (error) {
      logger.error("WebOS", `Key send failed: ${error}`);
      return { success: false, error: String(error), latencyMs: Date.now() - start };
    }
  };

  const sendKey = createKeySender(keymap, capabilities, sendPlatformKey);

  connection.on("connect", () => {
    logger.info("WebOS", `Connected to ${device.name}`);
    statusManager.setStatus("connected");

    // Run independent operations in parallel (async-parallel best practice)
    Promise.all([
      connection.getInputSocket().then((socket) => {
        inputSocket = socket;
      }),
      connection.subscribe("ssap://audio/getStatus", {}, (data) => {
        if (data.mute !== undefined) {
          currentMuteState = data.mute;
        }
      }),
    ]).catch((err) => {
      logger.warn("WebOS", `Post-connect setup failed: ${err}`);
    });
  });

  connection.on("close", () => {
    logger.info("WebOS", `Disconnected from ${device.name}`);
    inputSocket = null;
    if (!pairingInProgress) {
      statusManager.setStatus("disconnected");
    }
  });

  connection.on("error", (error) => {
    logger.error("WebOS", `Connection error: ${error}`);
    if (!pairingInProgress) {
      statusManager.setStatus("error");
    }
  });

  connection.on("prompt", () => {
    logger.info("WebOS", "Pairing prompt - waiting for user confirmation on TV");
  });

  connection.on("message", (data) => {
    logger.debug("WebOS", `Message: ${JSON.stringify(data)}`);
  });

  return {
    platform: "lg-webos",
    device,
    capabilities,

    getStatus: statusManager.getStatus,
    onStatusChange: statusManager.onStatusChange,

    async connect() {
      statusManager.setStatus("connecting");

      const hasCreds = connection.isPaired() || initialCredentials;
      if (!hasCreds) {
        statusManager.setStatus("error");
        throw new Error("WebOS TV requires pairing. Please pair first.");
      }

      try {
        await connection.connect();
      } catch (error) {
        statusManager.setStatus("error");
        throw error;
      }
    },

    async disconnect() {
      connection.disconnect();
      inputSocket = null;
      statusManager.setStatus("disconnected");
    },

    sendKey,
    isKeySupported: (key) => capabilities.supportedKeys.has(key),

    async sendText(text: string): Promise<CommandResult> {
      const start = Date.now();
      try {
        await connection.request(URI_INSERT_TEXT, { text, replace: 0 });
        return { success: true, latencyMs: Date.now() - start };
      } catch (error) {
        logger.error("WebOS", `Text input failed: ${error}`);
        return { success: false, error: String(error), latencyMs: Date.now() - start };
      }
    },

    async startPairing(): Promise<PairingState> {
      logger.info("WebOS", `Starting pairing for ${device.name} at ${device.ip}`);
      pairingInProgress = true;
      statusManager.setStatus("pairing");

      const firstStep = pairingSteps[0]!;

      connection = createWebOSConnection({
        ip: device.ip,
        mac: device.mac || "",
        timeout: 30000,
        reconnect: 0,
      });

      connection.on("prompt", () => {
        logger.info("WebOS", "Pairing prompt displayed on TV - waiting for user to confirm");
      });

      connection.on("error", (error) => {
        logger.error("WebOS", `Pairing connection error: ${error}`);
        statusManager.setStatus("error");
        pairingInProgress = false;
      });

      logger.info("WebOS", "Initiating WebSocket connection for pairing");
      connection.connect().catch((err) => {
        logger.error("WebOS", `Pairing connection failed: ${err}`);
        pairingInProgress = false;
        statusManager.setStatus("error");
      });

      return {
        currentStep: firstStep,
        stepIndex: 0,
        totalSteps: pairingSteps.length,
        inputs: {},
        isComplete: false,
      };
    },

    async submitPairingInput(_stepId: string, _input: string): Promise<PairingState> {
      const { isPaired, clientKey } = checkPairingStatus();

      if (isPaired && clientKey) {
        logger.info("WebOS", "Pairing completed successfully");
        pairingInProgress = false;
        return {
          currentStep: pairingSteps[2]!,
          stepIndex: 2,
          totalSteps: pairingSteps.length,
          inputs: {},
          isComplete: true,
          credentials: createCredentials(clientKey, device.mac || ""),
        };
      }

      logger.info("WebOS", "Still waiting for user confirmation on TV");
      return {
        currentStep: pairingSteps[1]!,
        stepIndex: 1,
        totalSteps: pairingSteps.length,
        inputs: {},
        isComplete: false,
        error: "Waiting for confirmation on TV. Press Enter to check again.",
      };
    },

    async executePairingAction(
      stepId: string,
    ): Promise<{ credentials?: WebOSCredentials; error?: string }> {
      if (stepId === "check_confirmation") {
        const { isPaired, clientKey } = checkPairingStatus();

        if (isPaired && clientKey) {
          logger.info("WebOS", "Pairing completed successfully");
          pairingInProgress = false;
          return { credentials: createCredentials(clientKey, device.mac || "") };
        }

        logger.info("WebOS", "Still waiting for user confirmation on TV");
        return { error: "Waiting for confirmation on TV. Press Enter to try again." };
      }

      return { error: "Unknown pairing step" };
    },

    async cancelPairing() {
      pairingInProgress = false;
      connection.disconnect();
      statusManager.setStatus("disconnected");
    },

    dispose() {
      connection.disconnect();
      inputSocket = null;
      statusManager.clearListeners();
    },
  };
}
