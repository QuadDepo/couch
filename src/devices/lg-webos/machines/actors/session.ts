import { fromCallback } from "xstate";
import type { RemoteKey } from "../../../../types";
import { logger } from "../../../../utils/logger";
import type { RemoteInputSocket } from "../../connection";
import { createWebOSConnection } from "../../connection";
import type { WebOSCredentials } from "../../credentials";
import { getInputSocketCommand, isInputSocketKey, keymap } from "../../keymap";
import { URI_INSERT_TEXT, URI_SET_MUTE } from "../../protocol";

export interface SessionInput {
  ip: string;
  credentials: WebOSCredentials;
  deviceName: string;
}

export type SessionEvent =
  | { type: "CONNECTED" }
  | { type: "CONNECTION_LOST"; error?: string }
  | { type: "HEARTBEAT_OK" }
  | { type: "HEARTBEAT_FAILED"; error: string }
  | { type: "MUTE_STATE_CHANGED"; mute: boolean }
  // Received from parent
  | { type: "SEND_KEY"; key: RemoteKey }
  | { type: "SEND_TEXT"; text: string }
  | { type: "CHECK_HEARTBEAT" };

export const sessionActor = fromCallback<SessionEvent, SessionInput>(
  ({ input, sendBack, receive }) => {
    logger.info("WebOS", `Starting session connection to ${input.deviceName}`, { ip: input.ip });

    const connection = createWebOSConnection({
      ip: input.ip,
      mac: input.credentials.mac ?? "",
      clientKey: input.credentials.clientKey,
      timeout: 15000,
      reconnect: 0,
    });

    let inputSocket: RemoteInputSocket | null = null;
    let muteState = false;
    let isConnected = false;

    // Connection established
    connection.on("connect", () => {
      isConnected = true;
      logger.info("WebOS", `Connected to ${input.deviceName}`);
      sendBack({ type: "CONNECTED" });

      // Set up input socket and subscribe to mute state
      // Note: Failures here are non-critical. Input socket will be lazily loaded
      // on first use, and mute subscription is just for status display
      connection
        .getInputSocket()
        .then((socket) => {
          inputSocket = socket;
          logger.debug("WebOS", "Input socket ready");
        })
        .catch((err) => {
          logger.warn("WebOS", `Failed to get input socket on connect (will retry on first use): ${err}`);
        });

      connection
        .subscribe("ssap://audio/getStatus", {}, (data) => {
          if (data.mute !== undefined) {
            muteState = data.mute;
            sendBack({ type: "MUTE_STATE_CHANGED", mute: data.mute });
          }
        })
        .catch((err) => {
          logger.warn("WebOS", `Failed to subscribe to mute status: ${err}`);
        });
    });

    // Connection closed
    connection.on("close", () => {
      if (isConnected) {
        isConnected = false;
        logger.info("WebOS", `Connection closed to ${input.deviceName}`);
        sendBack({ type: "CONNECTION_LOST", error: "Connection closed" });
      }
    });

    // Connection error
    connection.on("error", (error) => {
      logger.error("WebOS", `Connection error: ${error}`);
      sendBack({ type: "CONNECTION_LOST", error: String(error) });
    });

    // Handle commands from the parent machine
    receive((event) => {
      if (event.type === "CHECK_HEARTBEAT") {
        if (isConnected && connection.isConnected()) {
          sendBack({ type: "HEARTBEAT_OK" });
        } else {
          logger.warn("WebOS", "Heartbeat failed - connection lost");
          sendBack({ type: "HEARTBEAT_FAILED", error: "Connection lost" });
        }
        return;
      }

      if (event.type === "SEND_KEY") {
        const key = event.key;
        const keyCode = keymap[key];

        if (!keyCode) {
          logger.warn("WebOS", `Unsupported key: ${key}`);
          return;
        }

        if (!connection.isConnected()) {
          logger.warn("WebOS", "Cannot send key: not connected");
          return;
        }

        (async () => {
          try {
            if (isInputSocketKey(String(keyCode))) {
              if (!inputSocket) {
                try {
                  inputSocket = await connection.getInputSocket();
                } catch (err) {
                  logger.error("WebOS", `Failed to get input socket: ${err}`);
                  sendBack({ type: "CONNECTION_LOST", error: `Input socket unavailable: ${err}` });
                  return;
                }
              }
              const command = getInputSocketCommand(keyCode);
              inputSocket.send("button", { name: command });
              logger.debug("WebOS", `Sent key via input socket: ${key}`);
            } else if (String(keyCode) === URI_SET_MUTE) {
              await connection.request(String(keyCode), { mute: !muteState });
              muteState = !muteState;
              logger.debug("WebOS", `Toggled mute: ${muteState}`);
            } else {
              await connection.request(String(keyCode), {});
              logger.debug("WebOS", `Sent key via request: ${key}`);
            }
          } catch (error) {
            logger.error("WebOS", `Key send failed: ${error}`);
            sendBack({ type: "CONNECTION_LOST", error: `Command failed: ${error}` });
          }
        })();
      }

      if (event.type === "SEND_TEXT") {
        const text = event.text;

        if (!connection.isConnected()) {
          logger.warn("WebOS", "Cannot send text: not connected");
          return;
        }

        connection.request(URI_INSERT_TEXT, { text, replace: 0 }).catch((error) => {
          logger.error("WebOS", `Text send failed: ${error}`);
          sendBack({ type: "CONNECTION_LOST", error: `Text command failed: ${error}` });
        });
      }
    });

    // Start the connection
    connection.connect().catch((err) => {
      logger.error("WebOS", `Connection failed: ${err}`);
      sendBack({ type: "CONNECTION_LOST", error: String(err) });
    });

    // Cleanup
    return () => {
      logger.info("WebOS", `Closing session connection to ${input.deviceName}`);
      connection.disconnect();
      if (inputSocket) {
        inputSocket.close();
        inputSocket = null;
      }
    };
  },
);
