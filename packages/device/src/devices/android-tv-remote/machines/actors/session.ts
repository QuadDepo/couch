import { fromCallback } from "xstate";
import type { RemoteKey } from "../../../../types";
import { logger } from "../../../../utils/logger";
import type { AndroidTvRemoteCredentials } from "../../credentials";
import { keymap } from "../../keymap";
import { createAndroidTvRemoteConnection } from "../../remote/connection";

export interface SessionInput {
  ip: string;
  credentials: AndroidTvRemoteCredentials;
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
    logger.info("AndroidTVRemote", `Starting session connection to ${input.deviceName}`, {
      ip: input.ip,
    });

    const connection = createAndroidTvRemoteConnection({
      ip: input.ip,
      credentials: input.credentials,
      reconnect: 0,
    });

    let isConnected = false;

    connection.on("connect", () => {
      isConnected = true;
      logger.info("AndroidTVRemote", `Connected to ${input.deviceName}`);
      sendBack({ type: "CONNECTED" });
    });

    connection.on("close", () => {
      if (isConnected) {
        isConnected = false;
        logger.info("AndroidTVRemote", `Connection closed to ${input.deviceName}`);
        sendBack({ type: "CONNECTION_LOST", error: "Connection closed" });
      }
    });

    connection.on("error", (error) => {
      logger.error("AndroidTVRemote", `Connection error: ${error}`);
      sendBack({ type: "CONNECTION_LOST", error: String(error) });
    });

    // Relays a remote command, treating a not-connected state or a send failure
    // as a lost connection so the machine can retry.
    const sendCommand = (action: string, send: () => Promise<void>) => {
      if (!connection.isConnected()) {
        logger.warn("AndroidTVRemote", `Cannot ${action}: not connected`);
        return;
      }
      send().catch((error) => {
        logger.error("AndroidTVRemote", `${action} failed: ${error}`);
        sendBack({ type: "CONNECTION_LOST", error: `${action} failed: ${error}` });
      });
    };

    receive((event) => {
      if (event.type === "CHECK_HEARTBEAT") {
        if (isConnected && connection.isConnected()) {
          sendBack({ type: "HEARTBEAT_OK" });
        } else {
          logger.warn("AndroidTVRemote", "Heartbeat failed - connection lost");
          sendBack({ type: "HEARTBEAT_FAILED", error: "Connection lost" });
        }
        return;
      }

      if (event.type === "SEND_KEY") {
        const keyCode = keymap[event.key];
        if (!keyCode) {
          logger.warn("AndroidTVRemote", `Unsupported key: ${event.key}`);
          return;
        }
        sendCommand("send key", () => connection.sendKey(Number(keyCode)));
        return;
      }

      if (event.type === "SEND_TEXT") {
        sendCommand("send text", () => connection.sendText(event.text));
        return;
      }
    });

    connection.connect().catch((err) => {
      logger.error("AndroidTVRemote", `Connection failed: ${err}`);
      sendBack({ type: "CONNECTION_LOST", error: String(err) });
    });

    return () => {
      logger.info("AndroidTVRemote", `Closing session connection to ${input.deviceName}`);
      isConnected = false;
      connection.disconnect();
    };
  },
);
