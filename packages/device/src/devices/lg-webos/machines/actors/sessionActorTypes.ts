import type { DeviceDriver } from "../../../../drivers/types";
import type { DeviceLock } from "../../../../locks/deviceLock";
import type { DeviceSessionEvent } from "../../../commonEvents";
import type { ConnectionConfig, WebOSConnection } from "../../connectionTypes";
import type { WebOSCredentials } from "../../credentials";
import type { LgWebosDriverConfig } from "../../driver";

export interface SessionInput {
  ip: string;
  credentials: WebOSCredentials;
  deviceName: string;
  deviceId: string;
  useSsl?: boolean;
}

export type SessionEvent = DeviceSessionEvent | { type: "MUTE_STATE_CHANGED"; mute: boolean };

export interface LgWebosSessionDependencies {
  createDriver?: (
    config: LgWebosDriverConfig,
    dependencies: {
      connection: WebOSConnection;
      onMuteStateChanged: (mute: boolean) => void;
    },
  ) => DeviceDriver;
  createLock?: (directory: string) => DeviceLock;
  createConnection?: (config: ConnectionConfig) => WebOSConnection;
  lockDirectory?: string;
}
