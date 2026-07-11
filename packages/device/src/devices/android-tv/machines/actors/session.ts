import type { DeviceDriver } from "../../../../drivers/types";
import { createDeviceLock, type DeviceLock } from "../../../../locks/deviceLock";
import type { DeviceSessionEvent } from "../../../commonEvents";
import {
  createDriverSessionActor,
  DEFAULT_LOCK_DIRECTORY,
  type DriverSessionInput,
} from "../../../shared/driverSession";
import { type AndroidTvDriverConfig, createAndroidTvDriver } from "../../driver";
import { keymap } from "../../keymap";

export type SessionInput = DriverSessionInput;

export type SessionEvent = DeviceSessionEvent;

export interface AndroidTvSessionDependencies {
  createDriver?: (config: AndroidTvDriverConfig) => DeviceDriver;
  createLock?: (directory: string) => DeviceLock;
  lockDirectory?: string;
}

export function createAndroidTvSessionActor(dependencies: AndroidTvSessionDependencies = {}) {
  const makeDriver = dependencies.createDriver ?? ((config) => createAndroidTvDriver(config));
  const makeLock = dependencies.createLock ?? ((directory) => createDeviceLock(directory));
  const lockDirectory = dependencies.lockDirectory ?? DEFAULT_LOCK_DIRECTORY;

  return createDriverSessionActor<SessionInput>({
    logCategory: "ADB",
    platform: "android-tv",
    lockDirectory,
    createLock: makeLock,
    createDriver: ({ input }) => makeDriver({ ip: input.ip }),
    supportsKey: (key) => Boolean(keymap[key]),
    heartbeatFailedMessage: "Not connected",
    startLog: (input) => ({
      message: `Starting session connection to ${input.deviceName}`,
      details: { ip: input.ip },
    }),
    onConnected: (track) => {
      void track({ kind: "device.wake" }, false);
    },
  });
}

export const sessionActor = createAndroidTvSessionActor();
