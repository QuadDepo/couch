import { TextAttributes } from "@opentui/core";
import { useSelector } from "@xstate/react";
import type { ActorRefFrom } from "xstate";
import { WizardHints } from "../../components/dialogs/wizard/WizardHints.tsx";
import { ACTIVE_COLOR, DIM_COLOR, ERROR_COLOR, FOCUS_COLOR } from "../../constants/colors.ts";
import type { webosDeviceMachine } from "./machines/device";
import {
  isInitiating,
  isPairingConnecting,
  isPairingError,
  isPairingWaitingForUser,
  selectPairingError,
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
  actorRef: ActorRefFrom<typeof webosDeviceMachine>;
}

export function WebOSPairingStep({ actorRef }: Props) {
  const isInitiatingState = useSelector(actorRef, isInitiating);
  const isWaiting = useSelector(actorRef, isPairingWaitingForUser);
  const isConnecting = useSelector(actorRef, isPairingConnecting);
  const isError = useSelector(actorRef, isPairingError);
  const error = useSelector(actorRef, selectPairingError);

  const getHints = () => {
    if (isConnecting) return [HINT_BACK];
    if (isError) return [HINT_RETRY, HINT_BACK];
    return [];
  };

  const renderStep = () => {
    if (isInitiatingState) return <InitiatingStep />;
    if (isWaiting) return <WaitingStep />;
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
}
