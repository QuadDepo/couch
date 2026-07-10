import type { DeviceDriver } from "../../../../drivers/types";
import type { DeviceLock } from "../../../../locks/deviceLock";
import type { RemoteKey } from "../../../../types";
import type { WebOSConnection } from "../../connectionTypes";
import type { WebOSCredentials } from "../../credentials";
import type { LgWebosDriverConfig } from "../../driver";

export interface SessionInput {
  ip: string;
  credentials: WebOSCredentials;
  deviceName: string;
  deviceId: string;
  useSsl?: boolean;
}

export type SessionEvent =
  | { type: "CONNECTED" }
  | { type: "CONNECTION_LOST"; error?: string }
  | { type: "HEARTBEAT_OK" }
  | { type: "HEARTBEAT_FAILED"; error: string }
  | { type: "MUTE_STATE_CHANGED"; mute: boolean }
  | { type: "SEND_KEY"; key: RemoteKey }
  | { type: "SEND_TEXT"; text: string }
  | { type: "CHECK_HEARTBEAT" };

export interface LgWebosSessionDependencies {
  createDriver?: (
    config: LgWebosDriverConfig,
    dependencies: {
      connection: WebOSConnection;
      onMuteStateChanged: (mute: boolean) => void;
    },
  ) => DeviceDriver;
  createLock?: (directory: string) => DeviceLock;
  createConnection?: (config: {
    ip: string;
    mac: string;
    clientKey?: string;
    timeout: number;
    reconnect: number;
    useSsl: boolean;
  }) => WebOSConnection;
  lockDirectory?: string;
}
