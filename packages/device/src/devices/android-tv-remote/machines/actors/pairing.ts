import { fromCallback } from "xstate";
import { logger } from "../../../../utils/logger";
import type { AndroidTvRemoteCredentials } from "../../credentials";
import { createPairingConnection } from "../../pairing/connection";

export interface PairingInput {
  ip: string;
}

export type PairingEvent =
  | { type: "PROMPT_RECEIVED" }
  | { type: "PAIRED"; credentials: AndroidTvRemoteCredentials }
  | { type: "PAIRING_ERROR"; error: string }
  | { type: "SUBMIT_CODE"; code: string };

export const pairingActor = fromCallback<PairingEvent, PairingInput>(
  ({ input, sendBack, receive }) => {
    logger.info("AndroidTVRemote", `Starting pairing connection to ${input.ip}`);

    const connection = createPairingConnection(input.ip);
    let isCleanedUp = false;

    const runPairing = async () => {
      try {
        await connection.connect();
        logger.info("AndroidTVRemote", "Connected, waiting for code readiness");

        await connection.waitForCode();

        if (!isCleanedUp) {
          logger.info("AndroidTVRemote", "TV ready for code entry");
          sendBack({ type: "PROMPT_RECEIVED" });
        }
      } catch (error) {
        if (!isCleanedUp) {
          logger.error("AndroidTVRemote", `Pairing connection failed: ${error}`);
          sendBack({ type: "PAIRING_ERROR", error: String(error) });
        }
      }
    };

    receive((event) => {
      if (event.type === "SUBMIT_CODE") {
        connection
          .submitCode(event.code)
          .then((result) => {
            if (!isCleanedUp) {
              logger.info("AndroidTVRemote", "Pairing successful");
              sendBack({ type: "PAIRED", credentials: result.credentials });
            }
          })
          .catch((err) => {
            if (!isCleanedUp) {
              logger.error("AndroidTVRemote", `Code submission failed: ${err}`);
              sendBack({ type: "PAIRING_ERROR", error: String(err) });
            }
          });
      }
    });

    runPairing();

    return () => {
      isCleanedUp = true;
      logger.info("AndroidTVRemote", "Cleaning up pairing connection");
      connection.disconnect();
    };
  },
);
