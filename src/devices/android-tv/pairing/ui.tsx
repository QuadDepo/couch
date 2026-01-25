import { TextAttributes } from "@opentui/core";
import { useSelector } from "@xstate/react";
import { forwardRef, useCallback, useImperativeHandle } from "react";
import type { ActorRefFrom } from "xstate";
import { WizardHints } from "../../../components/dialogs/wizard/WizardHints.tsx";
import { ACTIVE_COLOR, DIM_COLOR, ERROR_COLOR } from "../../../constants/colors.ts";
import type { PairingHandle } from "../../../machines/pairing/types";
import { type androidTvPairingMachine, INFO_STEPS } from "./machine";

const HINT_CONTINUE = { key: "Enter", label: "to continue" };
const HINT_RETRY = { key: "Enter", label: "to retry" };
const HINT_BACK = { key: "Ctrl+Bs", label: "to go back" };

function getHints(stateValue: string, canGoBack: boolean) {
  switch (stateValue) {
    case "showingInfo":
      return canGoBack ? [HINT_CONTINUE, HINT_BACK] : [HINT_CONTINUE];
    case "connecting":
      return [HINT_BACK];
    case "error":
      return [HINT_RETRY, HINT_BACK];
    default:
      return [];
  }
}

interface InfoStepProps {
  title: string;
  description: string;
  currentStep: number;
  totalSteps: number;
}

function InfoStep({ title, description, currentStep, totalSteps }: InfoStepProps) {
  return (
    <>
      <text attributes={TextAttributes.BOLD}>{title}</text>
      <text fg={DIM_COLOR}>{description}</text>
      <text fg={DIM_COLOR} marginTop={1}>
        Step {currentStep} of {totalSteps}
      </text>
    </>
  );
}

function ConnectingStep({ totalSteps }: { totalSteps: number }) {
  return (
    <>
      <text attributes={TextAttributes.BOLD}>Connecting</text>
      <text fg="#FFAA00">Connecting to Android TV via ADB...</text>
      <text fg={DIM_COLOR} marginTop={1}>
        Step {totalSteps} of {totalSteps}
      </text>
    </>
  );
}

function SuccessStep() {
  return (
    <>
      <text attributes={TextAttributes.BOLD}>Connected!</text>
      <text fg={ACTIVE_COLOR}>Your Android TV has been connected successfully.</text>
    </>
  );
}

function ErrorStep({ error }: { error?: string }) {
  return (
    <>
      <text attributes={TextAttributes.BOLD}>Connection Failed</text>
      <text fg={ERROR_COLOR}>{error || "Failed to connect to Android TV"}</text>
      <text fg={DIM_COLOR} marginTop={1}>
        Make sure ADB debugging is enabled and the TV is on the same network.
      </text>
    </>
  );
}

interface Props {
  actorRef: ActorRefFrom<typeof androidTvPairingMachine>;
}

export const AndroidTvPairingUI = forwardRef<PairingHandle, Props>(function AndroidTvPairingUI(
  { actorRef },
  ref,
) {
  const currentState = useSelector(actorRef, (state) => state.value as string);
  const stepIndex = useSelector(actorRef, (state) => state.context.stepIndex);
  const error = useSelector(actorRef, (state) => state.context.error);

  const currentStep = INFO_STEPS[stepIndex];
  const totalSteps = INFO_STEPS.length + 1;

  const handleSubmit = useCallback(() => {
    const canSubmit = currentState === "showingInfo" || currentState === "error";

    if (canSubmit) {
      actorRef.send({ type: "SUBMIT" });
    }

    return canSubmit;
  }, [actorRef, currentState]);

  const canGoBack =
    (currentState === "showingInfo" && stepIndex > 0) ||
    currentState === "connecting" ||
    currentState === "error";

  const handleBack = useCallback(() => {
    if (canGoBack) {
      actorRef.send({ type: "BACK" });
    }

    return canGoBack;
  }, [actorRef, canGoBack]);

  useImperativeHandle(
    ref,
    () => ({
      handleChar: () => {},
      handleBackspace: () => {},
      handleSubmit,
      handleBack,
    }),
    [handleSubmit, handleBack],
  );

  const hints = getHints(currentState, canGoBack);

  const renderStep = () => {
    switch (currentState) {
      case "showingInfo":
        return currentStep ? (
          <InfoStep
            title={currentStep.title}
            description={currentStep.description}
            currentStep={stepIndex + 1}
            totalSteps={totalSteps}
          />
        ) : null;
      case "connecting":
        return <ConnectingStep totalSteps={totalSteps} />;
      case "success":
        return <SuccessStep />;
      case "error":
        return <ErrorStep error={error} />;
      default:
        return null;
    }
  };

  return (
    <box flexDirection="column" gap={1}>
      {renderStep()}
      {hints.length > 0 && <WizardHints hints={hints} />}
    </box>
  );
});
