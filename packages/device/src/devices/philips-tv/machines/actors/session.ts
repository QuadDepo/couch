import { fromCallback } from "xstate";
import type { RemoteKey } from "../../../../types";
import { logger } from "../../../../utils/logger";
import { createPhilipsConnection } from "../../connection";
import type { PhilipsCredentials } from "../../credentials";
import { keymap } from "../../keymap";

export interface SessionInput {
  ip: string;
  credentials: PhilipsCredentials;
  deviceName: string;
}

export type SessionEvent =
  | { type: "CONNECTED" }
  | { type: "CONNECTION_LOST"; error?: string }
  | { type: "HEARTBEAT_OK" }
  | { type: "HEARTBEAT_FAILED"; error: string }
  | { type: "SEND_KEY"; key: RemoteKey }
  | { type: "CHECK_HEARTBEAT" };

export const sessionActor = fromCallback<SessionEvent, SessionInput>(
  ({ input, sendBack, receive }) => {
    logger.info("Philips", `Starting session connection to ${input.deviceName}`, { ip: input.ip });

    const connection = createPhilipsConnection(input.ip, input.credentials);
    let isConnected = false;

    const runConnection = async () => {
      try {
        const powerState = await connection.request<{ powerstate: string }>("GET", "/powerstate");
        isConnected = true;
        logger.info("Philips", `Connected to ${input.deviceName}`, {
          powerstate: powerState.powerstate,
        });
        sendBack({ type: "CONNECTED" });
      } catch (error) {
        logger.error("Philips", `Connection failed: ${error}`);
        sendBack({ type: "CONNECTION_LOST", error: String(error) });
      }
    };

    receive((event) => {
      if (event.type === "CHECK_HEARTBEAT") {
        if (!isConnected) {
          sendBack({ type: "HEARTBEAT_FAILED", error: "Not connected" });
          return;
        }
        connection
          .request<{ powerstate: string }>("GET", "/powerstate")
          .then(() => {
            sendBack({ type: "HEARTBEAT_OK" });
          })
          .catch((error) => {
            logger.warn("Philips", `Heartbeat failed: ${error}`);
            sendBack({ type: "HEARTBEAT_FAILED", error: String(error) });
          });
        return;
      }

      if (event.type === "SEND_KEY") {
        const keyCode = keymap[event.key];
        if (!keyCode) {
          logger.warn("Philips", `Unsupported key: ${event.key}`);
          return;
        }

        if (!isConnected) {
          logger.warn("Philips", "Cannot send key: not connected");
          return;
        }

        connection.request("POST", "/input/key", { key: String(keyCode) }).catch((error) => {
          logger.error("Philips", `Key send failed: ${error}`);
        });
      }
    });

    runConnection();

    return () => {
      logger.info("Philips", `Closing session connection to ${input.deviceName}`);
      isConnected = false;
    };
  },
);
