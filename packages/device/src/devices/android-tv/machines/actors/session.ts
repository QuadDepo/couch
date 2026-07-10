import { fromCallback } from "xstate";
import type { RemoteKey } from "../../../../types";
import { logger } from "../../../../utils/logger";
import { createADBConnection } from "../../connection";
import { keymap } from "../../keymap";

export interface SessionInput {
  ip: string;
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
    logger.info("ADB", `Starting session connection to ${input.deviceName}`, { ip: input.ip });

    const adb = createADBConnection(input.ip);
    let isConnected = false;

    const runConnection = async () => {
      try {
        await adb.connect();
        isConnected = true;
        logger.info("ADB", `Connected to ${input.deviceName}`);
        sendBack({ type: "CONNECTED" });
      } catch (error) {
        logger.error("ADB", `Connection failed: ${error}`);
        sendBack({ type: "CONNECTION_LOST", error: String(error) });
      }
    };

    receive((event) => {
      if (event.type === "CHECK_HEARTBEAT") {
        if (!isConnected) {
          sendBack({ type: "HEARTBEAT_FAILED", error: "Not connected" });
          return;
        }
        adb
          .isConnected()
          .then((connected) => {
            if (connected) {
              sendBack({ type: "HEARTBEAT_OK" });
            } else {
              logger.warn("ADB", "Heartbeat failed - device disconnected");
              sendBack({ type: "HEARTBEAT_FAILED", error: "Device disconnected" });
            }
          })
          .catch((error) => {
            logger.warn("ADB", `Heartbeat failed: ${error}`);
            sendBack({ type: "HEARTBEAT_FAILED", error: String(error) });
          });
        return;
      }

      if (event.type === "SEND_KEY") {
        const keyCode = keymap[event.key];
        if (!keyCode) {
          logger.warn("ADB", `Unsupported key: ${event.key}`);
          return;
        }

        if (!isConnected) {
          logger.warn("ADB", "Cannot send key: not connected");
          return;
        }

        adb.sendKeyEvent(String(keyCode)).catch((error) => {
          logger.error("ADB", `Key send failed: ${error}`);
        });
      }

      if (event.type === "SEND_TEXT") {
        if (!isConnected) {
          logger.warn("ADB", "Cannot send text: not connected");
          return;
        }

        adb.sendText(event.text).catch((error) => {
          logger.error("ADB", `Text send failed: ${error}`);
        });
      }
    });

    runConnection();

    return () => {
      logger.info("ADB", `Closing session connection to ${input.deviceName}`);
      isConnected = false;
      adb.disconnect().catch((error) => {
        logger.debug("ADB", `Error during disconnect (may already be closed): ${error}`);
      });
    };
  },
);
