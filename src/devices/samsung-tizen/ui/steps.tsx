import { TextAttributes } from "@opentui/core";
import { useSelector } from "@xstate/react";
import type { ActorRefFrom } from "xstate";
import { HintGroup } from "../../../components/shared/HintGroup.tsx";
import {
  ERROR_COLOR,
  FOCUS_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  WARNING_COLOR,
} from "../../../constants/colors.ts";
import type { tizenDeviceMachine } from "../machines/device";
import {
  isInitiating,
  isPairingConnecting,
  isPairingError,
  isPairingWaitingForUser,
  selectPairingError,
} from "../selectors";

const HINT_RETRY = { key: "Enter", label: "to retry" };
const HINT_BACK = { key: "Ctrl+Bs", label: "to go back" };

function InitiatingStep() {
  return (
    <>
      <text fg={TEXT_SECONDARY}>
        Make sure your Samsung TV is turned on and connected to the same network.
      </text>
      <text fg={WARNING_COLOR} marginTop={1}>
        Connecting to TV...
      </text>
    </>
  );
}

function WaitingStep() {
  return (
    <>
      <text fg={TEXT_SECONDARY}>A connection request has been sent to your TV.</text>
      <text fg={FOCUS_COLOR} marginTop={1} attributes={TextAttributes.BOLD}>
        Please allow the connection on your TV screen.
      </text>
      <text fg={TEXT_SECONDARY} marginTop={1}>
        Waiting for approval...
      </text>
    </>
  );
}

function ErrorStep({ error }: { error?: string }) {
  return (
    <>
      <text fg={ERROR_COLOR}>{error || "Connection failed"}</text>
      <text fg={TEXT_SECONDARY} marginTop={1}>
        Make sure your TV is on and connected to the same network.
      </text>
    </>
  );
}

interface Props {
  actorRef: ActorRefFrom<typeof tizenDeviceMachine>;
}

export function TizenPairingStep({ actorRef }: Props) {
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
      <text fg={TEXT_PRIMARY} attributes={TextAttributes.BOLD}>
        Samsung TV Pairing
      </text>
      {renderStep()}
      {hints.length > 0 && (
        <box marginTop={1}>
          <HintGroup hints={hints} variant="plain" />
        </box>
      )}
    </box>
  );
}
