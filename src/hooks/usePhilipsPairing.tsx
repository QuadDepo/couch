import { useCallback } from "react";
import { useDialog } from "@opentui-ui/dialog/react";
import type { TVDevice, PhilipsCredentials } from "../types";
import { useDeviceStore } from "../store/deviceStore";
import { useDeviceHandler } from "./useDeviceHandler";
import { PinInputDialog } from "../components/dialogs/PinInputDialog";
import { logger } from "../utils/logger";

interface UsePhilipsPairingResult {
  needsPairing: boolean;
  handleConnect: () => Promise<void>;
}

export function usePhilipsPairing(device: TVDevice | null): UsePhilipsPairingResult {
  const dialog = useDialog();
  const updateDeviceConfig = useDeviceStore((s) => s.updateDeviceConfig);
  const { connect, startPairing, submitPairingInput } = useDeviceHandler(device);

  const needsPairing = device?.platform === "philips-android-tv" && !device.config?.philips;

  const handleConnect = useCallback(async () => {
    if (!device) return;

    if (!needsPairing) {
      connect();
      return;
    }

    logger.info("PhilipsPairing", "Starting pairing flow");

    const pairingState = await startPairing();
    if (pairingState?.error) {
      logger.error("PhilipsPairing", "Failed to start pairing", { error: pairingState.error });
      return;
    }

    const pin = await dialog.prompt<string>({
      content: (ctx) => <PinInputDialog {...ctx} />,
      size: "small",
      closeOnEscape: false,
    });

    if (!pin) {
      logger.info("PhilipsPairing", "Pairing cancelled");
      return;
    }

    logger.info("PhilipsPairing", "Submitting PIN", { pin });
    const state = await submitPairingInput("enter_pin", pin);

    if (state?.error) {
      logger.error("PhilipsPairing", "Pairing failed", { error: state.error });
    } else if (state?.isComplete && state.credentials) {
      logger.info("PhilipsPairing", "Pairing complete, saving credentials");
      updateDeviceConfig(device.id, { philips: state.credentials as PhilipsCredentials });
      setTimeout(() => connect(), 100);
    }
  }, [device, needsPairing, connect, startPairing, submitPairingInput, dialog, updateDeviceConfig]);

  return {
    needsPairing,
    handleConnect,
  };
}
