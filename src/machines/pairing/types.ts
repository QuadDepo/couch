import type { TVPlatform } from "../../types";

export interface PairingInput {
  deviceName: string;
  deviceIp: string;
  platform: TVPlatform;
}

export interface PairingOutput {
  credentials: unknown;
}

export interface PairingHandle {
  handleChar: (char: string) => void;
  handleBackspace: () => void;
  handleSubmit: () => void;
}
