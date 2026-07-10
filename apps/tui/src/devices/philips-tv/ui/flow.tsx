import { philipsDeviceMachine, type TVDevice, wrapPlatformCredentials } from "@couch/device";
import {
  isComplete,
  isPairing,
  isPairingError,
  isPairingWaitingForPin,
  isSetup,
  selectDeviceName,
  selectError,
} from "@couch/device/philips-tv/selectors";
import { useActorRef, useSelector } from "@xstate/react";
import { useState } from "react";
import { CompletionStep } from "../../../components/dialogs/wizard/CompletionStep.tsx";
import type { PairingFlowProps } from "../../../components/dialogs/wizard/types.ts";
import { WizardShell } from "../../../components/dialogs/wizard/WizardShell.tsx";
import {
  DeviceInfoFields,
  useDeviceInfoFields,
} from "../../../components/shared/DeviceInfoFields.tsx";
import { inspector } from "../../../utils/inspector.ts";
import { useDialogKeyboard } from "../../../vendor/dialog/react";
import { PhilipsPairingStep } from "./steps.tsx";

export function PhilipsPairingFlow({
  dialogId,
  onComplete,
  onCancel,
  onBackToPlatformSelection,
}: PairingFlowProps) {
  const actorRef = useActorRef(philipsDeviceMachine, {
    input: { platform: "philips-tv" as const },
    inspect: inspector?.inspect,
  });

  const deviceInfo = useDeviceInfoFields();

  // PIN input state (Philips-specific)
  const [pinInput, setPinInput] = useState("");

  const isSetupState = useSelector(actorRef, isSetup);
  const isPairingState = useSelector(actorRef, isPairing);
  const isCompleteState = useSelector(actorRef, isComplete);
  const isErrorState = useSelector(actorRef, isPairingError);
  const isWaitingForPinState = useSelector(actorRef, isPairingWaitingForPin);

  const deviceName = useSelector(actorRef, selectDeviceName);
  const error = useSelector(actorRef, selectError);

  useDialogKeyboard((event) => {
    if (event.name === "escape") {
      actorRef.stop();
      onCancel();
      return;
    }

    if (event.name === "backspace" && event.ctrl) {
      if (isPairingState) {
        actorRef.send({ type: "RESET_TO_SETUP" });
        setPinInput("");
        deviceInfo.reset();
      } else if (isSetupState) {
        onBackToPlatformSelection();
      }
      return;
    }

    switch (event.name) {
      case "return":
        if (isSetupState && deviceInfo.isValid) {
          actorRef.send({ type: "SET_DEVICE_INFO", name: deviceInfo.name, ip: deviceInfo.ip });
        } else if (isWaitingForPinState && pinInput.length === 4) {
          actorRef.send({ type: "SUBMIT_PIN", pin: pinInput });
        } else if (isErrorState) {
          setPinInput("");
          actorRef.send({ type: "START_PAIRING" });
        } else if (isCompleteState) {
          const {
            deviceId,
            deviceName: name,
            deviceIp,
            credentials,
          } = actorRef.getSnapshot().context;
          if (!deviceId) return;
          const device: TVDevice = {
            id: deviceId,
            name,
            ip: deviceIp,
            platform: "philips-tv",
            config: wrapPlatformCredentials("philips-tv", credentials),
          };
          onComplete({ device, actor: actorRef });
        }
        break;
      case "backspace":
        if (isSetupState) {
          deviceInfo.handleBackspace();
        } else if (isWaitingForPinState) {
          setPinInput((p) => p.slice(0, -1));
        }
        break;
      case "tab":
        if (isSetupState) deviceInfo.handleTab();
        break;
      default:
        if (event.sequence?.length === 1) {
          if (isSetupState) {
            deviceInfo.handleChar(event.sequence);
          } else if (isWaitingForPinState && pinInput.length < 4 && /^\d$/.test(event.sequence)) {
            setPinInput((p) => p + event.sequence);
          }
        }
    }
  }, dialogId);

  if (isSetupState) {
    return (
      <WizardShell stepLabel="Device Info" progress="1/3">
        <DeviceInfoFields
          name={deviceInfo.name}
          ip={deviceInfo.ip}
          activeField={deviceInfo.activeField}
          error={error}
        />
      </WizardShell>
    );
  }

  if (isPairingState) {
    return (
      <WizardShell stepLabel="Pairing" progress="2/3">
        <PhilipsPairingStep actorRef={actorRef} pinInput={pinInput} />
      </WizardShell>
    );
  }

  if (isCompleteState) {
    return (
      <WizardShell stepLabel="Complete" progress="3/3">
        <CompletionStep deviceName={deviceName || deviceInfo.name || "Device"} />
      </WizardShell>
    );
  }

  return null;
}
