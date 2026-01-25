import { TextAttributes } from "@opentui/core";
import { useSelector } from "@xstate/react";
import { forwardRef, useCallback, useImperativeHandle } from "react";
import type { ActorRefFrom } from "xstate";
import type { PairingHandle } from "../../../machines/pairing/types";
import { type androidTvPairingMachine, INFO_STEPS_DATA } from "./machine";

// Step Components

interface InfoStepProps {
  title: string;
  description: string;
  currentStep: number;
  totalSteps: number;
}

function InfoStep({ title, description, currentStep, totalSteps }: InfoStepProps) {
  return (
    <>
      <text fg="#FFFFFF" attributes={TextAttributes.BOLD}>
        {title}
      </text>
      <text fg="#AAAAAA">{description}</text>
      <text fg="#666666" marginTop={1}>
        Step {currentStep} of {totalSteps}
      </text>
    </>
  );
}

function ConnectingStep({ totalSteps }: { totalSteps: number }) {
  return (
    <>
      <text fg="#FFFFFF" attributes={TextAttributes.BOLD}>
        Connecting
      </text>
      <text fg="#FFAA00">Connecting to Android TV via ADB...</text>
      <text fg="#666666" marginTop={1}>
        Step {totalSteps} of {totalSteps}
      </text>
    </>
  );
}

function SuccessStep() {
  return (
    <>
      <text fg="#FFFFFF" attributes={TextAttributes.BOLD}>
        Connected!
      </text>
      <text fg="#00FF00">Your Android TV has been connected successfully.</text>
    </>
  );
}

function ErrorStep({ error }: { error?: string }) {
  return (
    <>
      <text fg="#FFFFFF" attributes={TextAttributes.BOLD}>
        Connection Failed
      </text>
      <text fg="#FF4444">{error || "Failed to connect to Android TV"}</text>
      <text fg="#AAAAAA" marginTop={1}>
        Make sure ADB debugging is enabled and the TV is on the same network.
      </text>
    </>
  );
}

// Main Component

interface Props {
  actorRef: ActorRefFrom<typeof androidTvPairingMachine>;
}

export const AndroidTvPairingUI = forwardRef<PairingHandle, Props>(
  function AndroidTvPairingUI({ actorRef }, ref) {
    const currentStepIndex = useSelector(actorRef, (state) => state.context.currentStepIndex);
    const isConnecting = useSelector(actorRef, (state) => state.matches("connecting"));
    const isSuccess = useSelector(actorRef, (state) => state.matches("success"));
    const isError = useSelector(actorRef, (state) => state.matches("error"));
    const isShowingInfo = useSelector(actorRef, (state) => state.matches("showingInfo"));
    const error = useSelector(actorRef, (state) => state.context.error);

    const currentStep = INFO_STEPS_DATA[currentStepIndex];
    const totalSteps = INFO_STEPS_DATA.length + 1;

    const handleSubmit = useCallback(() => {
      if (isShowingInfo || isError) {
        actorRef.send({ type: "SUBMIT" });
      }
    }, [actorRef, isShowingInfo, isError]);

    useImperativeHandle(
      ref,
      () => ({
        handleChar: () => {},
        handleBackspace: () => {},
        handleSubmit,
      }),
      [handleSubmit],
    );

    return (
      <box flexDirection="column" gap={1}>
        {isShowingInfo && currentStep && (
          <InfoStep
            title={currentStep.title}
            description={currentStep.description}
            currentStep={currentStepIndex + 1}
            totalSteps={totalSteps}
          />
        )}
        {isConnecting && <ConnectingStep totalSteps={totalSteps} />}
        {isSuccess && <SuccessStep />}
        {isError && <ErrorStep error={error} />}
      </box>
    );
  },
);
