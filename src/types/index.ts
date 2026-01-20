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

export interface PhilipsCredentials {
  deviceId: string;
  authKey: string;
}

export interface DeviceConfig {
  philips?: PhilipsCredentials;
}

export interface TVDevice {
  id: string;
  name: string;
  platform: TVPlatform;
  ip: string;
  mac?: string;
  status: ConnectionStatus;
  lastSeen?: Date;
  config?: DeviceConfig;
}
