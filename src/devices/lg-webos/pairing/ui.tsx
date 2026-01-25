import { TextAttributes } from "@opentui/core";
import { useSelector } from "@xstate/react";
import { forwardRef, useCallback, useImperativeHandle } from "react";
import type { ActorRefFrom } from "xstate";
import { WizardHints } from "../../../components/dialogs/wizard/WizardHints.tsx";
import { ACTIVE_COLOR, DIM_COLOR, ERROR_COLOR, FOCUS_COLOR } from "../../../constants/colors.ts";
import type { PairingHandle } from "../../../machines/pairing/types";
import type { webosPairingMachine } from "./machine";

const HINT_RETRY = { key: "Enter", label: "to retry" };
const HINT_BACK = { key: "Ctrl+Bs", label: "to go back" };

function getHints(currentState: string) {
  switch (currentState) {
    case "connecting":
      return [HINT_BACK];
    case "error":
      return [HINT_RETRY, HINT_BACK];
    default:
      return [];
  }
}

function InitiatingStep() {
  return (
    <>
      <text fg={DIM_COLOR}>Make sure your LG TV is turned on and connected to the same network.</text>
      <text fg="#FFAA00" marginTop={1}>
        Connecting to TV...
      </text>
    </>
  );
}

function WaitingStep() {
  return (
    <>
      <text fg={DIM_COLOR}>A pairing request has been sent to your TV.</text>
      <text fg={FOCUS_COLOR} marginTop={1} attributes={TextAttributes.BOLD}>
        Please accept the pairing request on your TV screen.
      </text>
      <text fg={DIM_COLOR} marginTop={1}>
        Waiting for confirmation...
      </text>
    </>
  );
}

function SuccessStep() {
  return (
    <>
      <text fg={ACTIVE_COLOR}>Your LG TV has been paired successfully!</text>
      <text fg={DIM_COLOR} marginTop={1}>
        The client key has been stored for future connections.
      </text>
    </>
  );
}

function ErrorStep({ error }: { error?: string }) {
  return (
    <>
      <text fg={ERROR_COLOR}>{error || "Connection failed"}</text>
      <text fg={DIM_COLOR} marginTop={1}>
        Make sure your TV is on and connected to the same network.
      </text>
    </>
  );
}

interface Props {
  actorRef: ActorRefFrom<typeof webosPairingMachine>;
}

export const WebOSPairingUI = forwardRef<PairingHandle, Props>(function WebOSPairingUI(
  { actorRef },
  ref,
) {
  const currentState = useSelector(actorRef, (state) => {
    if (state.matches({ connecting: "initiating" })) return "initiating";
    if (state.matches({ connecting: "waitingForConfirmation" })) return "waiting";
    if (state.matches("success")) return "success";
    if (state.matches("error")) return "error";
    return "connecting";
  });
  const error = useSelector(actorRef, (state) => state.context.error);

  const handleSubmit = useCallback(() => {
    const canSubmit = currentState === "error";

    if (canSubmit) {
      actorRef.send({ type: "SUBMIT" });
    }

    return canSubmit;
  }, [actorRef, currentState]);

  const handleBack = useCallback(() => {
    return false;
  }, []);

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

  const parentState = currentState === "initiating" || currentState === "waiting" ? "connecting" : currentState;
  const hints = getHints(parentState);

  const renderStep = () => {
    switch (currentState) {
      case "initiating":
        return <InitiatingStep />;
      case "waiting":
        return <WaitingStep />;
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
      <text attributes={TextAttributes.BOLD}>WebOS TV Pairing</text>
      {renderStep()}
      {hints.length > 0 && <WizardHints hints={hints} />}
    </box>
  );
});
