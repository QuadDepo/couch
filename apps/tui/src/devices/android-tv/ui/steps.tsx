import {
  type AndroidTVDeviceMachine,
  DIM_COLOR,
  ERROR_COLOR,
  FOCUS_COLOR,
  INSTRUCTION_STEPS,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  WARNING_COLOR,
} from "@couch/devices";
import {
  isPairingConnecting,
  isPairingError,
  isPairingWaitingForUser,
  selectInstructionStep,
  selectPairingError,
} from "@couch/devices/android-tv/selectors";
import { TextAttributes } from "@opentui/core";
import { useSelector } from "@xstate/react";
import type { ActorRefFrom } from "xstate";
import { HintGroup } from "../../../components/shared/HintGroup.tsx";

const HINT_CONTINUE = { key: "Enter", label: "to continue" };
const HINT_RETRY = { key: "Enter", label: "to retry" };
const HINT_BACK = { key: "Ctrl+Bs", label: "to go back" };

function ConnectingStep() {
  return (
    <>
      <text fg={TEXT_SECONDARY}>
        Make sure your Android TV is turned on and ADB debugging is enabled.
      </text>
      <text fg={WARNING_COLOR} marginTop={1}>
        Connecting via ADB...
      </text>
    </>
  );
}

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

function ErrorStep({ error }: { error?: string }) {
  return (
    <>
      <text fg={ERROR_COLOR}>{error || "Connection failed"}</text>
      <text fg={TEXT_SECONDARY} marginTop={1}>
        Make sure ADB debugging is enabled and the TV is on the same network.
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
    <box flexDirection="column" gap={1}>
      <text fg={TEXT_PRIMARY} attributes={TextAttributes.BOLD}>
        Android TV Setup
      </text>
      {currentStep && (
        <InstructionStepContent
          title={currentStep.title}
          description={currentStep.description}
          currentStep={stepIndex + 1}
          totalSteps={totalSteps}
        />
      )}
      <box marginTop={1}>
        <HintGroup hints={hints} variant="plain" />
      </box>
    </box>
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
    if (isConnecting) return <ConnectingStep />;
    if (isWaitingForUser) return <WaitingForUserStep />;
    if (isError) return <ErrorStep error={error} />;
    return null;
  };

  const hints = getHints();

  return (
    <box flexDirection="column" gap={1}>
      <text fg={TEXT_PRIMARY} attributes={TextAttributes.BOLD}>
        Android TV Pairing
      </text>
      {renderStep()}
      {hints.length > 0 && (
        <box marginTop={1}>
          <HintGroup hints={hints} variant="plain" />
        </box>
      )}
    </box>
  );
}
