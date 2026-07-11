import { createDeviceLock } from "../../../../locks/deviceLock";
import { createDriverSessionActor, DEFAULT_LOCK_DIRECTORY } from "../../../shared/driverSession";
import { createWebOSConnection } from "../../connection";
import { createLgWebosDriver } from "../../driver";
import { keymap } from "../../keymap";
import type { LgWebosSessionDependencies, SessionInput } from "./sessionActorTypes";

type MuteStateEvent = { type: "MUTE_STATE_CHANGED"; mute: boolean };

export function createLgWebosSessionActor(dependencies: LgWebosSessionDependencies = {}) {
  const makeLock = dependencies.createLock ?? ((directory) => createDeviceLock(directory));
  const makeConnection = dependencies.createConnection ?? createWebOSConnection;
  const makeDriver =
    dependencies.createDriver ??
    ((config, driverDependencies) => createLgWebosDriver(config, driverDependencies));
  const lockDirectory = dependencies.lockDirectory ?? DEFAULT_LOCK_DIRECTORY;

  return createDriverSessionActor<SessionInput, MuteStateEvent>({
    logCategory: "WebOS",
    platform: "lg-webos",
    lockDirectory,
    createLock: makeLock,
    createDriver: ({ input, sendBack, reportFailure, isConnected }) => {
      const useSsl = input.useSsl ?? input.credentials.useSsl ?? false;
      const connection = makeConnection({
        ip: input.ip,
        mac: input.credentials.mac ?? "",
        clientKey: input.credentials.clientKey,
        timeout: 15000,
        reconnect: 0,
        useSsl,
      });

      connection.on("close", () => {
        if (isConnected()) reportFailure("Connection closed");
      });
      connection.on("error", (error) => {
        reportFailure(error);
      });

      return makeDriver(
        { ip: input.ip, credentials: input.credentials, useSsl },
        {
          connection,
          onMuteStateChanged: (mute) => sendBack({ type: "MUTE_STATE_CHANGED", mute }),
        },
      );
    },
    supportsKey: (key) => Boolean(keymap[key]),
    heartbeatFailedMessage: "Connection lost",
    startLog: (input) => {
      const useSsl = input.useSsl ?? input.credentials.useSsl ?? false;
      return {
        message: `Starting session connection to ${input.deviceName} (SSL: ${useSsl})`,
        details: { ip: input.ip },
      };
    },
  });
}

export const sessionActor = createLgWebosSessionActor();
