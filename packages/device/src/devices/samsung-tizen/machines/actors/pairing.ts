import { fromCallback } from "xstate";
import { logger } from "../../../../utils/logger";
import { createTizenConnection } from "../../connection";

export interface PairingInput {
  ip: string;
}

export type PairingEvent =
  | { type: "PROMPT_RECEIVED" }
  | { type: "PAIRED"; token: string }
  | { type: "PAIRING_ERROR"; error: string };

export const pairingActor = fromCallback<PairingEvent, PairingInput>(({ input, sendBack }) => {
  logger.info("Tizen", `Starting pairing connection to ${input.ip}`);

  const connection = createTizenConnection({
    ip: input.ip,
    timeout: 30000,
  });

  let paired = false;

  connection.on("connect", () => {
    const token = connection.getToken();
    if (token) {
      paired = true;
      logger.info("Tizen", "Got token, pairing successful");
      sendBack({ type: "PAIRED", token });
    } else {
      logger.info("Tizen", "Connected without token - TV is showing approval dialog");
      sendBack({ type: "PROMPT_RECEIVED" });
    }
  });

  connection.on("error", (error) => {
    if (!paired) {
      logger.error("Tizen", `Pairing connection error: ${error}`);
      sendBack({ type: "PAIRING_ERROR", error: String(error) });
    }
  });

  logger.info("Tizen", "Initiating connection for pairing");
  connection.connect().catch((err) => {
    if (!paired) {
      logger.error("Tizen", `Pairing connection failed: ${err}`);
      sendBack({ type: "PAIRING_ERROR", error: String(err) });
    }
  });

  return () => {
    logger.info("Tizen", "Cleaning up pairing connection");
    connection.disconnect();
  };
});
