import { TextAttributes } from "@opentui/core";
import { useSelector } from "@xstate/react";
import type { ActorRefFrom } from "xstate";
import { WizardHints } from "../../components/dialogs/wizard/WizardHints.tsx";
import { ACTIVE_COLOR, DIM_COLOR, ERROR_COLOR, FOCUS_COLOR } from "../../constants/colors.ts";
import type { androidTVDeviceMachine } from "./machines/device";
import {
  isPairingConnecting,
  isPairingError,
  isPairingWaitingForUser,
  selectPairingError,
} from "./selectors";

const HINT_RETRY = { key: "Enter", label: "to retry" };
const HINT_BACK = { key: "Ctrl+Bs", label: "to go back" };

function ConnectingStep() {
  return (
    <>
      <text fg={DIM_COLOR}>
        Make sure your Android TV is turned on and ADB debugging is enabled.
      </text>
      <text fg="#FFAA00" marginTop={1}>
        Connecting via ADB...
      </text>
    </>
  );
}

function WaitingForUserStep() {
  return (
    <>
      <text fg={DIM_COLOR}>An ADB debugging prompt should appear on your TV.</text>
      <text fg={FOCUS_COLOR} marginTop={1} attributes={TextAttributes.BOLD}>
        Please allow the USB debugging request on your TV.
      </text>
      <text fg={DIM_COLOR} marginTop={1}>
        Make sure "Always allow from this computer" is checked.
      </text>
    </>
  );
}

function ErrorStep({ error }: { error?: string }) {
  return (
    <>
      <text fg={ERROR_COLOR}>{error || "Connection failed"}</text>
      <text fg={DIM_COLOR} marginTop={1}>
        Make sure ADB debugging is enabled and the TV is on the same network.
      </text>
    </>
  );
}

interface Props {
  actorRef: ActorRefFrom<typeof androidTVDeviceMachine>;
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
      <text attributes={TextAttributes.BOLD}>Android TV Pairing</text>
      {renderStep()}
      {hints.length > 0 && <WizardHints hints={hints} />}
    </box>
  );
}
