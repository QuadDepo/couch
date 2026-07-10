import { fromCallback } from "xstate";
import { logger } from "../../../../utils/logger";
import { createPhilipsConnection } from "../../connection";
import type { PhilipsCredentials } from "../../credentials";

export interface PairingInput {
  ip: string;
  deviceName: string;
}

export type PairingEvent =
  | { type: "PROMPT_RECEIVED" }
  | { type: "PAIRED"; credentials: PhilipsCredentials }
  | { type: "PAIRING_ERROR"; error: string }
  | { type: "SUBMIT_PIN"; pin: string };

interface PairingData {
  authKey: string;
  timestamp: number;
  deviceId: string;
}

export const pairingActor = fromCallback<PairingEvent, PairingInput>(
  ({ input, sendBack, receive }) => {
    logger.info("Philips", `Starting pairing connection to ${input.ip}`);

    const connection = createPhilipsConnection(input.ip);
    let pairingData: PairingData | null = null;
    let isCleanedUp = false;

    const startPairingProcess = async () => {
      try {
        logger.info("Philips", "Initiating pairing request");
        const data = await connection.startPairing(input.deviceName);
        pairingData = data;

        if (!isCleanedUp) {
          logger.info("Philips", "PIN should now be displayed on TV");
          sendBack({ type: "PROMPT_RECEIVED" });
        }
      } catch (error) {
        if (!isCleanedUp) {
          logger.error("Philips", `Pairing request failed: ${error}`);
          sendBack({ type: "PAIRING_ERROR", error: String(error) });
        }
      }
    };

    receive(async (event) => {
      if (event.type === "SUBMIT_PIN") {
        if (!pairingData) {
          sendBack({ type: "PAIRING_ERROR", error: "Pairing data not available" });
          return;
        }

        if (!/^\d{4}$/.test(event.pin)) {
          sendBack({ type: "PAIRING_ERROR", error: "Please enter a valid 4-digit PIN" });
          return;
        }

        try {
          logger.info("Philips", "Confirming pairing with PIN");
          const credentials = await connection.confirmPairing(
            event.pin,
            pairingData.authKey,
            pairingData.timestamp,
            pairingData.deviceId,
            input.deviceName,
          );

          if (!isCleanedUp) {
            logger.info("Philips", "Pairing successful");
            sendBack({ type: "PAIRED", credentials });
          }
        } catch (error) {
          if (!isCleanedUp) {
            logger.error("Philips", `Pairing confirmation failed: ${error}`);
            sendBack({ type: "PAIRING_ERROR", error: String(error) });
          }
        }
      }
    });

    startPairingProcess();

    return () => {
      isCleanedUp = true;
      logger.info("Philips", "Cleaning up pairing connection");
    };
  },
);
