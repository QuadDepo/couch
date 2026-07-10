import { type AndroidTVDeviceMachine, INSTRUCTION_STEPS } from "@couch/device";
import {
  isPairingConnecting,
  isPairingError,
  isPairingWaitingForUser,
  selectInstructionStep,
  selectPairingError,
} from "@couch/device/android-tv/selectors";
import { TextAttributes } from "@opentui/core";
import { useSelector } from "@xstate/react";
import type { ActorRefFrom } from "xstate";
import { HINT_BACK, HINT_CONTINUE, HINT_RETRY } from "../../../components/shared/pairing/hints.ts";
import { PairingConnectingStep } from "../../../components/shared/pairing/PairingConnectingStep.tsx";
import { PairingErrorStep } from "../../../components/shared/pairing/PairingErrorStep.tsx";
import { PairingStepLayout } from "../../../components/shared/pairing/PairingStepLayout.tsx";
import { DIM_COLOR, FOCUS_COLOR, TEXT_PRIMARY, TEXT_SECONDARY } from "../../../constants/colors.ts";

function WaitingForUserStep() {
  return (
    <>
      <text fg={TEXT_SECONDARY}>An ADB debugging prompt should appear on your TV.</text>
      <text fg={FOCUS_COLOR} marginTop={1} attributes={TextAttributes.BOLD}>
        Please allow the USB debugging request on your TV.
      </text>
      <text fg={TEXT_SECONDARY} marginTop={1}>
        Make sure "Always allow from this computer" is checked.
      </text>
    </>
  );
}

interface InstructionStepContentProps {
  title: string;
  description: string;
  currentStep: number;
  totalSteps: number;
}

function InstructionStepContent({
  title,
  description,
  currentStep,
  totalSteps,
}: InstructionStepContentProps) {
  return (
    <>
      <text fg={TEXT_PRIMARY} attributes={TextAttributes.BOLD}>
        {title}
      </text>
      <text fg={TEXT_SECONDARY}>{description}</text>
      <text fg={DIM_COLOR} marginTop={1}>
        Step {currentStep} of {totalSteps}
      </text>
    </>
  );
}

interface Props {
  actorRef: ActorRefFrom<AndroidTVDeviceMachine>;
}

export function AndroidTVInstructionsStep({ actorRef }: Props) {
  const stepIndex = useSelector(actorRef, selectInstructionStep);
  const currentStep = INSTRUCTION_STEPS[stepIndex];
  const totalSteps = INSTRUCTION_STEPS.length;

  const hints = [HINT_CONTINUE, HINT_BACK];

  return (
    <PairingStepLayout title="Android TV Setup" hints={hints}>
      {currentStep && (
        <InstructionStepContent
          title={currentStep.title}
          description={currentStep.description}
          currentStep={stepIndex + 1}
          totalSteps={totalSteps}
        />
      )}
    </PairingStepLayout>
  );
}

export function AndroidTVPairingStep({ actorRef }: Props) {
  const isConnecting = useSelector(actorRef, isPairingConnecting);
  const isWaitingForUser = useSelector(actorRef, isPairingWaitingForUser);
  const isError = useSelector(actorRef, isPairingError);
  const error = useSelector(actorRef, selectPairingError);

  const getHints = () => {
    if (isConnecting || isWaitingForUser) return [HINT_BACK];
    if (isError) return [HINT_RETRY, HINT_BACK];
    return [];
  };

  const renderStep = () => {
    if (isConnecting)
      return (
        <PairingConnectingStep
          title="Make sure your Android TV is turned on and ADB debugging is enabled."
          subtext="Connecting via ADB..."
        />
      );
    if (isWaitingForUser) return <WaitingForUserStep />;
    if (isError) return <PairingErrorStep error={error} />;
    return null;
  };

  return (
    <PairingStepLayout title="Android TV Pairing" hints={getHints()}>
      {renderStep()}
    </PairingStepLayout>
  );
}
