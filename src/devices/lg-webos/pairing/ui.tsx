import { TextAttributes } from "@opentui/core";
import { useSelector } from "@xstate/react";
import { forwardRef, useCallback, useImperativeHandle } from "react";
import type { ActorRefFrom } from "xstate";
import { WizardHints } from "../../../components/dialogs/wizard/WizardHints.tsx";
import { ACTIVE_COLOR, DIM_COLOR, ERROR_COLOR, FOCUS_COLOR } from "../../../constants/colors.ts";
import type { PairingHandle } from "../../../machines/pairing/types";
import type { webosPairingMachine } from "./machine";
import {
  isConnectingState,
  isErrorState,
  isInitiatingState,
  isSuccessState,
  isWaitingState,
  selectError,
} from "./selectors";

const HINT_RETRY = { key: "Enter", label: "to retry" };
const HINT_BACK = { key: "Ctrl+Bs", label: "to go back" };

function InitiatingStep() {
  return (
    <>
      <text fg={DIM_COLOR}>
        Make sure your LG TV is turned on and connected to the same network.
      </text>
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
  const isInitiating = useSelector(actorRef, isInitiatingState);
  const isWaiting = useSelector(actorRef, isWaitingState);
  const isConnecting = useSelector(actorRef, isConnectingState);
  const isSuccess = useSelector(actorRef, isSuccessState);
  const isError = useSelector(actorRef, isErrorState);
  const error = useSelector(actorRef, selectError);

  const handleSubmit = useCallback(() => {
    if (isError) {
      actorRef.send({ type: "SUBMIT" });
      return true;
    }
    return false;
  }, [actorRef, isError]);

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

  const getHints = () => {
    if (isConnecting) return [HINT_BACK];
    if (isError) return [HINT_RETRY, HINT_BACK];
    return [];
  };

  const renderStep = () => {
    if (isInitiating) return <InitiatingStep />;
    if (isWaiting) return <WaitingStep />;
    if (isSuccess) return <SuccessStep />;
    if (isError) return <ErrorStep error={error} />;
    return null;
  };

  const hints = getHints();

  return (
    <box flexDirection="column" gap={1}>
      <text attributes={TextAttributes.BOLD}>WebOS TV Pairing</text>
      {renderStep()}
      {hints.length > 0 && <WizardHints hints={hints} />}
    </box>
  );
});
