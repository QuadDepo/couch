import { TextAttributes } from "@opentui/core";
import { useSelector } from "@xstate/react";
import { forwardRef, useCallback, useImperativeHandle } from "react";
import type { ActorRefFrom } from "xstate";
import { WizardHints } from "../../../components/dialogs/wizard/WizardHints.tsx";
import { ACTIVE_COLOR, DIM_COLOR, ERROR_COLOR } from "../../../constants/colors.ts";
import type { PairingHandle } from "../../../machines/pairing/types";
import { type androidTvPairingMachine, INFO_STEPS } from "./machine";
import {
  isConnectingState,
  isErrorState,
  isShowingInfoState,
  isSuccessState,
  selectError,
  selectStepIndex,
} from "./selectors";

const HINT_CONTINUE = { key: "Enter", label: "to continue" };
const HINT_RETRY = { key: "Enter", label: "to retry" };
const HINT_BACK = { key: "Ctrl+Bs", label: "to go back" };

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
  const isShowingInfo = useSelector(actorRef, isShowingInfoState);
  const isConnecting = useSelector(actorRef, isConnectingState);
  const isSuccess = useSelector(actorRef, isSuccessState);
  const isError = useSelector(actorRef, isErrorState);
  const stepIndex = useSelector(actorRef, selectStepIndex);
  const error = useSelector(actorRef, selectError);

  const currentStep = INFO_STEPS[stepIndex];
  const totalSteps = INFO_STEPS.length + 1;

  const handleSubmit = useCallback(() => {
    if (isShowingInfo || isError) {
      actorRef.send({ type: "SUBMIT" });
      return true;
    }
    return false;
  }, [actorRef, isShowingInfo, isError]);

  const canGoBack = (isShowingInfo && stepIndex > 0) || isConnecting || isError;

  const handleBack = useCallback(() => {
    if (canGoBack) {
      actorRef.send({ type: "BACK" });
      return true;
    }
    return false;
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

  const getHints = () => {
    if (isShowingInfo) return [HINT_CONTINUE, HINT_BACK];
    if (isConnecting) return [HINT_BACK];
    if (isError) return [HINT_RETRY, HINT_BACK];
    return [];
  };

  const renderStep = () => {
    if (isShowingInfo && currentStep) {
      return (
        <InfoStep
          title={currentStep.title}
          description={currentStep.description}
          currentStep={stepIndex + 1}
          totalSteps={totalSteps}
        />
      );
    }
    if (isConnecting) return <ConnectingStep totalSteps={totalSteps} />;
    if (isSuccess) return <SuccessStep />;
    if (isError) return <ErrorStep error={error} />;
    return null;
  };

  const hints = getHints();

  return (
    <box flexDirection="column" gap={1}>
      {renderStep()}
      {hints.length > 0 && <WizardHints hints={hints} />}
    </box>
  );
});
