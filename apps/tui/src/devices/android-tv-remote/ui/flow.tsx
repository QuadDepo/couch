import {
  androidTvRemoteDeviceMachine,
  inspector,
  type TVDevice,
  wrapPlatformCredentials,
} from "@couch/devices";
import {
  isComplete,
  isPairing,
  isPairingError,
  isPairingWaitingForUser,
  isSetup,
  selectDeviceName,
  selectError,
  selectPairingCode,
} from "@couch/devices/android-tv-remote/selectors";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useActorRef, useSelector } from "@xstate/react";
import { CompletionStep } from "../../../components/dialogs/wizard/CompletionStep.tsx";
import type { PairingFlowProps } from "../../../components/dialogs/wizard/types.ts";
import { WizardShell } from "../../../components/dialogs/wizard/WizardShell.tsx";
import {
  DeviceInfoFields,
  useDeviceInfoFields,
} from "../../../components/shared/DeviceInfoFields.tsx";
import { AndroidTvRemotePairingStep } from "./steps.tsx";

const HEX_CHARS = /^[0-9a-fA-F]$/;

export function AndroidTvRemotePairingFlow({
  dialogId,
  onComplete,
  onCancel,
  onBackToPlatformSelection,
}: PairingFlowProps) {
  const actorRef = useActorRef(androidTvRemoteDeviceMachine, {
    input: { platform: "android-tv-remote" as const },
    inspect: inspector?.inspect,
  });

  const deviceInfo = useDeviceInfoFields();

  const isSetupState = useSelector(actorRef, isSetup);
  const isPairingState = useSelector(actorRef, isPairing);
  const isCompleteState = useSelector(actorRef, isComplete);
  const isErrorState = useSelector(actorRef, isPairingError);
  const isWaitingForCode = useSelector(actorRef, isPairingWaitingForUser);

  const deviceName = useSelector(actorRef, selectDeviceName);
  const error = useSelector(actorRef, selectError);
  const pairingCode = useSelector(actorRef, selectPairingCode);

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
        } else if (isWaitingForCode && pairingCode.length === 6) {
          actorRef.send({ type: "SUBMIT_CODE", code: pairingCode });
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
            platform: "android-tv-remote",
            config: wrapPlatformCredentials("android-tv-remote", credentials),
          };
          onComplete({ device, actor: actorRef });
        }
        break;
      case "backspace":
        if (isSetupState) {
          deviceInfo.handleBackspace();
        } else if (isWaitingForCode && pairingCode.length > 0) {
          actorRef.send({ type: "SET_PAIRING_CODE", code: pairingCode.slice(0, -1) });
        }
        break;
      case "tab":
        if (isSetupState) deviceInfo.handleTab();
        break;
      default:
        if (event.sequence?.length === 1) {
          if (isSetupState) {
            deviceInfo.handleChar(event.sequence);
          } else if (isWaitingForCode && HEX_CHARS.test(event.sequence) && pairingCode.length < 6) {
            actorRef.send({
              type: "SET_PAIRING_CODE",
              code: pairingCode + event.sequence.toUpperCase(),
            });
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
        <AndroidTvRemotePairingStep actorRef={actorRef} />
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
