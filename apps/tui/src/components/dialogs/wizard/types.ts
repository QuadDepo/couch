import type { DeviceActor, TVDevice } from "@couch/devices";

export interface PairingFlowResult {
  device: TVDevice;
  actor: DeviceActor;
}

export interface PairingFlowHandle {
  canGoBack: () => boolean;
  canContinue: () => boolean;
  // Returns true if wizard should exit to platform selection, false if handled internally
  handleBack: () => boolean;
  handleContinue: () => void;
  handleChar: (char: string) => void;
  handleBackspace: () => void;
  handleTab: () => void;
  cleanup: () => void;
}

export interface PairingFlowProps {
  onComplete: (result: PairingFlowResult) => void;
}
