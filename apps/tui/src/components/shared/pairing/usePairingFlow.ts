import {
  type DeviceActor,
  type TVDevice,
  type TVPlatform,
  wrapPlatformCredentials,
} from "@couch/device";
import type { KeyEvent } from "@opentui/core";
import { type DialogId, useDialogKeyboard } from "../../../vendor/dialog/react";
import type { PairingFlowResult } from "../../dialogs/wizard/types.ts";
import type { DeviceInfoFieldsState } from "../DeviceInfoFields.tsx";

// Protocol-specific keyboard behaviour layered onto the shared pairing skeleton.
// Every callback runs only once the flow is past the setup step; platforms that
// have no pairing-phase input (webOS, Tizen) omit the protocol entirely.
export interface PairingProtocol {
  // Ctrl+Backspace past setup. Defaults to resetting to the setup step.
  goBack?: () => void;
  // Enter in a protocol sub-state (advance instructions, submit code/pin). Runs
  // before the shared error-retry and completion handling; return true when it
  // consumed the key.
  submit?: () => boolean;
  // Backspace past setup (code/pin editing). Return true when it consumed the key.
  erase?: () => boolean;
  // Printable character past setup (code/pin entry). Return true when consumed.
  type?: (char: string) => boolean;
  // Runs before START_PAIRING on retry, e.g. to clear local input state.
  beforeRetry?: () => void;
}

interface PairingFlowOptions {
  actorRef: DeviceActor;
  platform: TVPlatform;
  dialogId: DialogId;
  deviceInfo: DeviceInfoFieldsState;
  isSetupState: boolean;
  isPairingState: boolean;
  isErrorState: boolean;
  isCompleteState: boolean;
  onComplete: (result: PairingFlowResult) => void;
  onCancel: () => void;
  onBackToPlatformSelection: () => void;
  protocol?: PairingProtocol;
}

export function usePairingFlow(options: PairingFlowOptions): void {
  const {
    actorRef,
    platform,
    dialogId,
    deviceInfo,
    isSetupState,
    isPairingState,
    isErrorState,
    isCompleteState,
    onComplete,
    onCancel,
    onBackToPlatformSelection,
    protocol,
  } = options;

  const completeDevice = () => {
    const { deviceId, deviceName, deviceIp, credentials } = actorRef.getSnapshot().context;
    if (!deviceId) return;

    const device: TVDevice = {
      id: deviceId,
      name: deviceName,
      ip: deviceIp,
      platform,
      config: wrapPlatformCredentials(platform, credentials),
    };
    onComplete({ device, actor: actorRef });
  };

  const handleReturn = () => {
    if (isSetupState) {
      if (deviceInfo.isValid) {
        actorRef.send({ type: "SET_DEVICE_INFO", name: deviceInfo.name, ip: deviceInfo.ip });
      }
      return;
    }

    if (protocol?.submit?.()) return;

    if (isErrorState) {
      protocol?.beforeRetry?.();
      actorRef.send({ type: "START_PAIRING" });
      return;
    }

    if (isCompleteState) completeDevice();
  };

  useDialogKeyboard((event: KeyEvent) => {
    if (event.name === "escape") {
      actorRef.stop();
      onCancel();
      return;
    }

    if (event.name === "backspace" && event.ctrl) {
      if (isSetupState) {
        onBackToPlatformSelection();
      } else if (protocol?.goBack) {
        protocol.goBack();
      } else if (isPairingState) {
        actorRef.send({ type: "RESET_TO_SETUP" });
        deviceInfo.reset();
      }
      return;
    }

    switch (event.name) {
      case "return":
        handleReturn();
        break;
      case "backspace":
        if (isSetupState) {
          deviceInfo.handleBackspace();
        } else {
          protocol?.erase?.();
        }
        break;
      case "tab":
        if (isSetupState) deviceInfo.handleTab();
        break;
      default:
        if (event.sequence?.length === 1) {
          if (isSetupState) {
            deviceInfo.handleChar(event.sequence);
          } else {
            protocol?.type?.(event.sequence);
          }
        }
    }
  }, dialogId);
}
