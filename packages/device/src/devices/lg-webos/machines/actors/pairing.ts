import { fromCallback } from "xstate";
import { logger } from "../../../../utils/logger";
import { createWebOSConnection } from "../../connection";

export interface PairingInput {
  ip: string;
  useSsl?: boolean;
}

export type PairingEvent =
  | { type: "PROMPT_RECEIVED" }
  | { type: "PAIRED"; clientKey: string }
  | { type: "PAIRING_ERROR"; error: string };

export const pairingActor = fromCallback<PairingEvent, PairingInput>(({ input, sendBack }) => {
  logger.info(
    "WebOS",
    `Starting pairing connection to ${input.ip} (SSL: ${input.useSsl ?? false})`,
  );

  const connection = createWebOSConnection({
    ip: input.ip,
    mac: "",
    timeout: 30000,
    reconnect: 0,
    useSsl: input.useSsl,
  });

  connection.on("prompt", () => {
    logger.info("WebOS", "Received prompt event - TV is showing pairing dialog");
    sendBack({ type: "PROMPT_RECEIVED" });
  });

  connection.on("connect", () => {
    logger.info("WebOS", "Received connect event from connection");
    const clientKey = connection.getClientKey();
    if (clientKey) {
      logger.info("WebOS", "Got client key, pairing successful");
      sendBack({ type: "PAIRED", clientKey });
    }
  });

  connection.on("error", (error) => {
    logger.error("WebOS", `Pairing connection error: ${error}`);
    sendBack({ type: "PAIRING_ERROR", error: String(error) });
  });

  logger.info("WebOS", "Initiating connection for pairing");
  connection.connect().catch((err) => {
    logger.error("WebOS", `Pairing connection failed: ${err}`);
    sendBack({ type: "PAIRING_ERROR", error: String(err) });
  });

  return () => {
    logger.info("WebOS", "Cleaning up pairing connection");
    connection.disconnect();
  };
});
