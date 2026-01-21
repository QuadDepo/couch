export type TVPlatform =
  | "android-tv"
  | "philips-android-tv"
  | "lg-webos"
  | "samsung-tizen"
  | "titan-os"
  | "apple-tv";

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "pairing"
  | "error";

export type RemoteKey =
  | "UP"
  | "DOWN"
  | "LEFT"
  | "RIGHT"
  | "OK"
  | "BACK"
  | "HOME"
  | "MENU"
  | "POWER"
  | "VOLUME_UP"
  | "VOLUME_DOWN"
  | "MUTE"
  | "CHANNEL_UP"
  | "CHANNEL_DOWN"
  | "INPUT"
  | "PLAY"
  | "PAUSE"
  | "STOP"
  | "REWIND"
  | "FAST_FORWARD";

import type { PhilipsCredentials } from "../devices/philips-android-tv/credentials";

type PlatformConfig<P extends TVPlatform> =
  P extends "philips-android-tv"
    ? { philips: PhilipsCredentials }
  : P extends "android-tv" | "lg-webos" | "samsung-tizen" | "titan-os" | "apple-tv"
    ? Record<string, never>
  : Record<string, unknown>;

export interface TVDevice<P extends TVPlatform = TVPlatform> {
  id: string;
  name: string;
  platform: P;
  ip: string;
  mac?: string;
  status: ConnectionStatus;
  lastSeen?: Date;
  config?: PlatformConfig<P>;
}
