import { fromCallback } from "xstate";
import type { RemoteKey } from "../../../../types";
import { logger } from "../../../../utils/logger";
import { createTizenConnection } from "../../connection";
import type { TizenCredentials } from "../../credentials";
import { keymap } from "../../keymap";

export interface SessionInput {
  ip: string;
  credentials: TizenCredentials;
  deviceName: string;
}

export type SessionEvent =
  | { type: "CONNECTED" }
  | { type: "CONNECTION_LOST"; error?: string }
  | { type: "HEARTBEAT_OK" }
  | { type: "HEARTBEAT_FAILED"; error: string }
  | { type: "SEND_KEY"; key: RemoteKey }
  | { type: "SEND_TEXT"; text: string }
  | { type: "CHECK_HEARTBEAT" };

export const sessionActor = fromCallback<SessionEvent, SessionInput>(
  ({ input, sendBack, receive }) => {
    logger.info("Tizen", `Starting session connection to ${input.deviceName}`, {
      ip: input.ip,
    });

    const connection = createTizenConnection({
      ip: input.ip,
      token: input.credentials.token,
      timeout: 15000,
    });

    let isConnected = false;

    connection.on("connect", () => {
      isConnected = true;
      logger.info("Tizen", `Connected to ${input.deviceName}`);
      sendBack({ type: "CONNECTED" });
    });

    connection.on("close", () => {
      if (isConnected) {
        isConnected = false;
        logger.info("Tizen", `Connection closed to ${input.deviceName}`);
        sendBack({ type: "CONNECTION_LOST", error: "Connection closed" });
      }
    });

    connection.on("error", (error) => {
      logger.error("Tizen", `Connection error: ${error}`);
      sendBack({ type: "CONNECTION_LOST", error: String(error) });
    });

    receive((event) => {
      if (event.type === "CHECK_HEARTBEAT") {
        if (isConnected && connection.isConnected()) {
          sendBack({ type: "HEARTBEAT_OK" });
        } else {
          logger.warn("Tizen", "Heartbeat failed - connection lost");
          sendBack({ type: "HEARTBEAT_FAILED", error: "Connection lost" });
        }
        return;
      }

      if (event.type === "SEND_KEY") {
        const keyCode = keymap[event.key];

        if (!keyCode) {
          logger.warn("Tizen", `Unsupported key: ${event.key}`);
          return;
        }

        if (!connection.isConnected()) {
          logger.warn("Tizen", "Cannot send key: not connected");
          return;
        }

        connection.sendKey(String(keyCode)).catch((error) => {
          logger.error("Tizen", `Key send failed: ${error}`);
          sendBack({ type: "CONNECTION_LOST", error: `Command failed: ${error}` });
        });
      }

      if (event.type === "SEND_TEXT") {
        if (!connection.isConnected()) {
          logger.warn("Tizen", "Cannot send text: not connected");
          return;
        }

        if (event.text === "\n") {
          connection.sendInputEnd().catch((error) => {
            logger.error("Tizen", `InputEnd (confirm) failed: ${error}`);
            sendBack({ type: "CONNECTION_LOST", error: `Command failed: ${error}` });
          });
          return;
        }

        if (event.text === "\b") {
          logger.warn("Tizen", "Backspace not supported via Samsung WebSocket API");
          return;
        }

        connection.sendText(event.text).catch((error) => {
          logger.error("Tizen", `Text send failed: ${error}`);
          sendBack({ type: "CONNECTION_LOST", error: `Text command failed: ${error}` });
        });
      }
    });

    connection.connect().catch((err) => {
      logger.error("Tizen", `Connection failed: ${err}`);
      sendBack({ type: "CONNECTION_LOST", error: String(err) });
    });

    return () => {
      logger.info("Tizen", `Closing session connection to ${input.deviceName}`);
      connection.disconnect();
    };
  },
);
