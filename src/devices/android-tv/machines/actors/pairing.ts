import { fromCallback } from "xstate";
import { logger } from "../../../../utils/logger";
import { createADBConnection } from "../../connection";

export interface PairingInput {
  ip: string;
}

export type PairingEvent =
  | { type: "PROMPT_RECEIVED" }
  | { type: "PAIRED" }
  | { type: "PAIRING_ERROR"; error: string };

export const pairingActor = fromCallback<PairingEvent, PairingInput>(({ input, sendBack }) => {
  logger.info("ADB", `Starting pairing connection to ${input.ip}`);

  const adb = createADBConnection(input.ip);
  let isCleanedUp = false;

  const runPairing = async () => {
    try {
      sendBack({ type: "PROMPT_RECEIVED" });
      logger.info("ADB", "Attempting ADB connect - user should approve on TV if prompted");

      await adb.connect();

      if (!isCleanedUp) {
        logger.info("ADB", "ADB connection established, pairing successful");
        sendBack({ type: "PAIRED" });
      }
    } catch (error) {
      if (!isCleanedUp) {
        logger.error("ADB", `Pairing connection failed: ${error}`);
        sendBack({ type: "PAIRING_ERROR", error: String(error) });
      }
    }
  };

  runPairing();

  return () => {
    isCleanedUp = true;
    logger.info("ADB", "Cleaning up pairing connection");
    adb.disconnect().catch((error) => {
      logger.debug("ADB", `Error during disconnect (may already be closed): ${error}`);
    });
  };
});
