import type { DeviceActor, TVDevice } from "@couch/devices";
import type { DialogId } from "@opentui-ui/dialog/react";

export interface PairingFlowResult {
  device: TVDevice;
  actor: DeviceActor;
}

export interface PairingFlowProps {
  dialogId: DialogId;
  onComplete: (result: PairingFlowResult) => void;
  // Cancel the wizard (Esc). Flows stop their pairing actor before calling this.
  onCancel: () => void;
  // Return to the platform-selection step (Ctrl+Backspace from the first flow step).
  onBackToPlatformSelection: () => void;
}
