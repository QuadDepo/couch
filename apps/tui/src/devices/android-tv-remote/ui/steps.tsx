import {
  type AndroidTvRemoteDeviceMachine,
  FOCUS_COLOR,
  TEXT_SECONDARY,
  WARNING_COLOR,
} from "@couch/devices";
import {
  isPairingConnecting,
  isPairingError,
  isPairingVerifying,
  isPairingWaitingForUser,
  selectPairingCode,
  selectPairingError,
} from "@couch/devices/android-tv-remote/selectors";
import { TextAttributes } from "@opentui/core";
import { useSelector } from "@xstate/react";
import type { ActorRefFrom } from "xstate";
import { PairingErrorStep } from "../../../components/shared/pairing/PairingErrorStep.tsx";
import { PairingStepLayout } from "../../../components/shared/pairing/PairingStepLayout.tsx";

const HINT_SUBMIT = { key: "Enter", label: "to submit code" };
const HINT_RETRY = { key: "Enter", label: "to retry" };
const HINT_BACK = { key: "Ctrl+Bs", label: "to go back" };

function ConnectingStep() {
  return (
    <>
      <text fg={TEXT_SECONDARY}>Connecting to TV for pairing...</text>
      <text fg={WARNING_COLOR} marginTop={1}>
        Make sure the TV is turned on and on the same network.
      </text>
    </>
  );
}

function CodeEntryStep({ code }: { code: string }) {
  const display = code.padEnd(6, "_").split("").join(" ");
  return (
    <>
      <text fg={TEXT_SECONDARY}>A 6-character code should be displayed on your TV.</text>
      <text fg={FOCUS_COLOR} marginTop={1} attributes={TextAttributes.BOLD}>
        Enter the code: {display}
      </text>
      <text fg={TEXT_SECONDARY} marginTop={1}>
        Type the hex characters (0-9, A-F) shown on screen.
      </text>
    </>
  );
}

function VerifyingStep() {
  return <text fg={WARNING_COLOR}>Verifying pairing code...</text>;
}

interface Props {
  actorRef: ActorRefFrom<AndroidTvRemoteDeviceMachine>;
}

export function AndroidTvRemotePairingStep({ actorRef }: Props) {
  const isConnecting = useSelector(actorRef, isPairingConnecting);
  const isWaitingForUser = useSelector(actorRef, isPairingWaitingForUser);
  const isVerifying = useSelector(actorRef, isPairingVerifying);
  const isError = useSelector(actorRef, isPairingError);
  const error = useSelector(actorRef, selectPairingError);
  const code = useSelector(actorRef, selectPairingCode);

  const getHints = () => {
    if (isConnecting || isVerifying) return [HINT_BACK];
    if (isWaitingForUser && code.length === 6) return [HINT_SUBMIT, HINT_BACK];
    if (isWaitingForUser) return [HINT_BACK];
    if (isError) return [HINT_RETRY, HINT_BACK];
    return [];
  };

  const renderStep = () => {
    if (isConnecting) return <ConnectingStep />;
    if (isWaitingForUser) return <CodeEntryStep code={code} />;
    if (isVerifying) return <VerifyingStep />;
    if (isError) return <PairingErrorStep error={error} />;
    return null;
  };

  return (
    <PairingStepLayout title="Android TV Remote Pairing" hints={getHints()}>
      {renderStep()}
    </PairingStepLayout>
  );
}
