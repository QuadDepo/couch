import { androidTvRemoteDeviceMachine } from "@couch/device";
import {
  isComplete,
  isPairing,
  isPairingError,
  isPairingWaitingForUser,
  isSetup,
  selectDeviceName,
  selectError,
  selectPairingCode,
} from "@couch/device/android-tv-remote/selectors";
import { useActorRef, useSelector } from "@xstate/react";
import type { PairingFlowProps } from "../../../components/dialogs/wizard/types.ts";
import { WizardShell } from "../../../components/dialogs/wizard/WizardShell.tsx";
import { useDeviceInfoFields } from "../../../components/shared/DeviceInfoFields.tsx";
import {
  PairingCompleteStage,
  PairingSetupStage,
} from "../../../components/shared/pairing/stages.tsx";
import { usePairingFlow } from "../../../components/shared/pairing/usePairingFlow.ts";
import { inspector } from "../../../utils/inspector.ts";
import { AndroidTvRemotePairingStep } from "./steps.tsx";

const HEX_CHARS = /^[0-9a-fA-F]$/;
const PAIRING_CODE_LENGTH = 6;

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

  usePairingFlow({
    actorRef,
    platform: "android-tv-remote",
    dialogId,
    deviceInfo,
    isSetupState,
    isPairingState,
    isErrorState,
    isCompleteState,
    onComplete,
    onCancel,
    onBackToPlatformSelection,
    protocol: {
      submit: () => {
        if (!isWaitingForCode || pairingCode.length !== PAIRING_CODE_LENGTH) return false;
        actorRef.send({ type: "SUBMIT_CODE", code: pairingCode });
        return true;
      },
      erase: () => {
        if (!isWaitingForCode || pairingCode.length === 0) return false;
        actorRef.send({ type: "SET_PAIRING_CODE", code: pairingCode.slice(0, -1) });
        return true;
      },
      type: (char) => {
        if (
          !isWaitingForCode ||
          !HEX_CHARS.test(char) ||
          pairingCode.length >= PAIRING_CODE_LENGTH
        ) {
          return false;
        }
        actorRef.send({ type: "SET_PAIRING_CODE", code: pairingCode + char.toUpperCase() });
        return true;
      },
    },
  });

  if (isSetupState) {
    return <PairingSetupStage progress="1/3" deviceInfo={deviceInfo} error={error} />;
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
      <PairingCompleteStage progress="3/3" deviceName={deviceName || deviceInfo.name || "Device"} />
    );
  }

  return null;
}
