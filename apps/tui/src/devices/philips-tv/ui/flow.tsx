import { philipsDeviceMachine } from "@couch/device";
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
import type { PairingFlowProps } from "../../../components/dialogs/wizard/types.ts";
import { WizardShell } from "../../../components/dialogs/wizard/WizardShell.tsx";
import { useDeviceInfoFields } from "../../../components/shared/DeviceInfoFields.tsx";
import {
  PairingCompleteStage,
  PairingSetupStage,
} from "../../../components/shared/pairing/stages.tsx";
import { usePairingFlow } from "../../../components/shared/pairing/usePairingFlow.ts";
import { inspector } from "../../../utils/inspector.ts";
import { PhilipsPairingStep } from "./steps.tsx";

const PIN_LENGTH = 4;
const DIGIT = /^\d$/;

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

  usePairingFlow({
    actorRef,
    platform: "philips-tv",
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
        if (!isWaitingForPinState || pinInput.length !== PIN_LENGTH) return false;
        actorRef.send({ type: "SUBMIT_PIN", pin: pinInput });
        return true;
      },
      erase: () => {
        if (!isWaitingForPinState) return false;
        setPinInput((p) => p.slice(0, -1));
        return true;
      },
      type: (char) => {
        if (!isWaitingForPinState || pinInput.length >= PIN_LENGTH || !DIGIT.test(char)) {
          return false;
        }
        setPinInput((p) => p + char);
        return true;
      },
      goBack: () => {
        if (!isPairingState) return;
        actorRef.send({ type: "RESET_TO_SETUP" });
        setPinInput("");
        deviceInfo.reset();
      },
      beforeRetry: () => setPinInput(""),
    },
  });

  if (isSetupState) {
    return <PairingSetupStage progress="1/3" deviceInfo={deviceInfo} error={error} />;
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
      <PairingCompleteStage progress="3/3" deviceName={deviceName || deviceInfo.name || "Device"} />
    );
  }

  return null;
}
