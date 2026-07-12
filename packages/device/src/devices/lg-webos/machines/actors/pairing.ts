import { fromCallback } from "xstate";
import { logger } from "../../../../utils/logger";
import { createWebOSConnection } from "../../connection";
import type { ConnectionConfig, WebOSConnection } from "../../connectionTypes";

export interface PairingInput {
  ip: string;
  useSsl?: boolean;
}

export type PairingEvent =
  | { type: "PROMPT_RECEIVED" }
  | { type: "PAIRED"; clientKey: string }
  | { type: "PAIRING_ERROR"; error: string };

export function createPairingActor(
  createConnection: (config: ConnectionConfig) => WebOSConnection = createWebOSConnection,
) {
  return fromCallback<PairingEvent, PairingInput>(({ input, sendBack }) => {
    logger.info(
      "WebOS",
      `Starting pairing connection to ${input.ip} (SSL: ${input.useSsl ?? false})`,
    );

    const connection = createConnection({
      ip: input.ip,
      mac: "",
      timeout: 30000,
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

    logger.info("WebOS", "Initiating connection for pairing");
    connection.connect().catch((err) => {
      logger.error("WebOS", `Pairing connection failed: ${err}`);
      sendBack({ type: "PAIRING_ERROR", error: String(err) });
    });

    return () => {
      logger.info("WebOS", "Cleaning up pairing connection");
      void connection.disconnect();
    };
  });
}

export const pairingActor = createPairingActor();
