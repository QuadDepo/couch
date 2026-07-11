import { tizenDeviceMachine } from "@couch/device";
import {
  isComplete,
  isPairing,
  isPairingError,
  isSetup,
  selectDeviceName,
  selectError,
} from "@couch/device/samsung-tizen/selectors";
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

  usePairingFlow({
    actorRef,
    platform: "samsung-tizen",
    dialogId,
    deviceInfo,
    isSetupState,
    isPairingState,
    isErrorState,
    isCompleteState,
    onComplete,
    onCancel,
    onBackToPlatformSelection,
  });

  if (isSetupState) {
    return <PairingSetupStage progress="1/3" deviceInfo={deviceInfo} error={error} />;
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
      <PairingCompleteStage progress="3/3" deviceName={deviceName} fallbackName={deviceInfo.name} />
    );
  }

  return null;
}
