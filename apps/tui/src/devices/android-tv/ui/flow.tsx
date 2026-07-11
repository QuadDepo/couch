import { androidTVDeviceMachine } from "@couch/device";
import {
  isComplete,
  isPairing,
  isPairingError,
  isPairingInstructions,
  isSetup,
  selectDeviceName,
  selectError,
} from "@couch/device/android-tv/selectors";
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
import { AndroidTVInstructionsStep, AndroidTVPairingStep } from "./steps.tsx";

export function AndroidTVPairingFlow({
  dialogId,
  onComplete,
  onCancel,
  onBackToPlatformSelection,
}: PairingFlowProps) {
  const actorRef = useActorRef(androidTVDeviceMachine, {
    input: { platform: "android-tv" as const },
    inspect: inspector?.inspect,
  });

  const deviceInfo = useDeviceInfoFields();

  const isSetupState = useSelector(actorRef, isSetup);
  const isInstructionsState = useSelector(actorRef, isPairingInstructions);
  const isPairingState = useSelector(actorRef, isPairing);
  const isCompleteState = useSelector(actorRef, isComplete);
  const isErrorState = useSelector(actorRef, isPairingError);

  const deviceName = useSelector(actorRef, selectDeviceName);
  const error = useSelector(actorRef, selectError);

  usePairingFlow({
    actorRef,
    platform: "android-tv",
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
        if (!isInstructionsState) return false;
        actorRef.send({ type: "CONTINUE_INSTRUCTION" });
        return true;
      },
      goBack: () => {
        if (isInstructionsState) {
          actorRef.send({ type: "BACK_INSTRUCTION" });
        } else if (isPairingState) {
          actorRef.send({ type: "RESET_TO_SETUP" });
          deviceInfo.reset();
        }
      },
    },
  });

  if (isSetupState) {
    return <PairingSetupStage progress="1/4" deviceInfo={deviceInfo} error={error} />;
  }

  if (isInstructionsState) {
    return (
      <WizardShell stepLabel="Setup Instructions" progress="2/4">
        <AndroidTVInstructionsStep actorRef={actorRef} />
      </WizardShell>
    );
  }

  if (isPairingState) {
    return (
      <WizardShell stepLabel="Pairing" progress="3/4">
        <AndroidTVPairingStep actorRef={actorRef} />
      </WizardShell>
    );
  }

  if (isCompleteState) {
    return (
      <PairingCompleteStage progress="4/4" deviceName={deviceName} fallbackName={deviceInfo.name} />
    );
  }

  return null;
}
