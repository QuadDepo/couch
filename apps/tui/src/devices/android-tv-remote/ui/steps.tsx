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
import {
  HINT_BACK,
  HINT_RETRY,
  HINT_SUBMIT_CODE,
} from "../../../components/shared/pairing/hints.ts";
import { PairingConnectingStep } from "../../../components/shared/pairing/PairingConnectingStep.tsx";
import { PairingErrorStep } from "../../../components/shared/pairing/PairingErrorStep.tsx";
import { PairingStepLayout } from "../../../components/shared/pairing/PairingStepLayout.tsx";

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
    if (isWaitingForUser && code.length === 6) return [HINT_SUBMIT_CODE, HINT_BACK];
    if (isWaitingForUser) return [HINT_BACK];
    if (isError) return [HINT_RETRY, HINT_BACK];
    return [];
  };

  const renderStep = () => {
    if (isConnecting)
      return (
        <PairingConnectingStep
          title="Connecting to TV for pairing..."
          subtext="Make sure the TV is turned on and on the same network."
        />
      );
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
