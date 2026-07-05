import {
  inspector,
  type TVDevice,
  tizenDeviceMachine,
  wrapPlatformCredentials,
} from "@couch/devices";
import {
  isComplete,
  isPairing,
  isPairingError,
  isSetup,
  selectDeviceName,
  selectError,
} from "@couch/devices/samsung-tizen/selectors";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useActorRef, useSelector } from "@xstate/react";
import { CompletionStep } from "../../../components/dialogs/wizard/CompletionStep.tsx";
import type { PairingFlowProps } from "../../../components/dialogs/wizard/types.ts";
import { WizardShell } from "../../../components/dialogs/wizard/WizardShell.tsx";
import {
  DeviceInfoFields,
  useDeviceInfoFields,
} from "../../../components/shared/DeviceInfoFields.tsx";
import { TizenPairingStep } from "./steps.tsx";

export function TizenPairingFlow({
  dialogId,
  onComplete,
  onCancel,
  onBackToPlatformSelection,
}: PairingFlowProps) {
  const actorRef = useActorRef(tizenDeviceMachine, {
    input: { platform: "samsung-tizen" as const },
    inspect: inspector?.inspect,
  });

  const deviceInfo = useDeviceInfoFields();

  const isSetupState = useSelector(actorRef, isSetup);
  const isPairingState = useSelector(actorRef, isPairing);
  const isCompleteState = useSelector(actorRef, isComplete);
  const isErrorState = useSelector(actorRef, isPairingError);

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
        } else if (isErrorState) {
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
            platform: "samsung-tizen",
            config: wrapPlatformCredentials("samsung-tizen", credentials),
          };
          onComplete({ device, actor: actorRef });
        }
        break;
      case "backspace":
        if (isSetupState) deviceInfo.handleBackspace();
        break;
      case "tab":
        if (isSetupState) deviceInfo.handleTab();
        break;
      default:
        if (isSetupState && event.sequence?.length === 1) {
          deviceInfo.handleChar(event.sequence);
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
        <TizenPairingStep actorRef={actorRef} />
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
