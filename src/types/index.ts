export type TVPlatform =
  | "lg-webos"
  | "samsung-tizen"
  | "android-tv"
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

// TV Device representation
export interface TVDevice {
  id: string;
  name: string;
  platform: TVPlatform;
  ip: string;
  mac?: string;
  status: ConnectionStatus;
  lastSeen?: Date;
}
