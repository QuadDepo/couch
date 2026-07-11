import type { AndroidTvRemoteCredentials } from "../devices/android-tv-remote/credentials";
import type { WebOSCredentials } from "../devices/lg-webos/credentials";
import type { PhilipsCredentials } from "../devices/philips-tv/credentials";
import type { TizenCredentials } from "../devices/samsung-tizen/credentials";

export type TVPlatform =
  | "android-tv"
  | "android-tv-remote"
  | "philips-tv"
  | "lg-webos"
  | "samsung-tizen";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "pairing" | "error";

export const REMOTE_KEYS = [
  "UP",
  "DOWN",
  "LEFT",
  "RIGHT",
  "OK",
  "BACK",
  "HOME",
  "MENU",
  "EXIT",
  "INFO",
  "POWER",
  "VOLUME_UP",
  "VOLUME_DOWN",
  "MUTE",
  "CHANNEL_UP",
  "CHANNEL_DOWN",
  "INPUT",
  "PLAY",
  "PAUSE",
  "STOP",
  "REWIND",
  "FAST_FORWARD",
] as const;

export type RemoteKey = (typeof REMOTE_KEYS)[number];

const REMOTE_KEY_SET: ReadonlySet<string> = new Set(REMOTE_KEYS);

export function isRemoteKey(value: string): value is RemoteKey {
  return REMOTE_KEY_SET.has(value);
}

type PlatformConfig<P extends TVPlatform> = P extends "lg-webos"
  ? { webos: WebOSCredentials }
  : P extends "android-tv-remote"
    ? { androidTvRemote: AndroidTvRemoteCredentials }
    : P extends "philips-tv"
      ? { philips: PhilipsCredentials }
      : P extends "samsung-tizen"
        ? { tizen: TizenCredentials }
        : Record<string, unknown>;

export interface TVDevice<P extends TVPlatform = TVPlatform> {
  id: string;
  name: string;
  platform: P;
  ip: string;
  mac?: string;
  lastSeen?: Date;
  config?: PlatformConfig<P>;
}
