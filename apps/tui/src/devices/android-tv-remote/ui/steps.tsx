import type { AndroidTvRemoteDeviceMachine } from "@couch/device";
import {
  isPairingConnecting,
  isPairingError,
  isPairingVerifying,
  isPairingWaitingForUser,
  selectPairingCode,
  selectPairingError,
} from "@couch/device/android-tv-remote/selectors";
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
import { PairingStateView } from "../../../components/shared/pairing/PairingStateView.tsx";
import { FOCUS_COLOR, TEXT_SECONDARY, WARNING_COLOR } from "../../../constants/colors.ts";

export const PAIRING_CODE_LENGTH = 6;

function CodeEntryStep({ code }: { code: string }) {
  const display = code.padEnd(PAIRING_CODE_LENGTH, "_").split("").join(" ");
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

  return (
    <PairingStateView
      title="Android TV Remote Pairing"
      states={[
        {
          active: isConnecting,
          hints: [HINT_BACK],
          content: (
            <PairingConnectingStep
              title="Connecting to TV for pairing..."
              subtext="Make sure the TV is turned on and on the same network."
            />
          ),
        },
        {
          active: isWaitingForUser,
          hints: code.length === PAIRING_CODE_LENGTH ? [HINT_SUBMIT_CODE, HINT_BACK] : [HINT_BACK],
          content: <CodeEntryStep code={code} />,
        },
        { active: isVerifying, hints: [HINT_BACK], content: <VerifyingStep /> },
        {
          active: isError,
          hints: [HINT_RETRY, HINT_BACK],
          content: <PairingErrorStep error={error} />,
        },
      ]}
    />
  );
}
