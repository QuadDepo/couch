import type { TizenDeviceMachine } from "@couch/device";
import {
  isInitiating,
  isPairingConnecting,
  isPairingError,
  isPairingWaitingForUser,
  selectPairingError,
} from "@couch/device/samsung-tizen/selectors";
import { TextAttributes } from "@opentui/core";
import { useSelector } from "@xstate/react";
import type { ActorRefFrom } from "xstate";
import { HINT_BACK, HINT_RETRY } from "../../../components/shared/pairing/hints.ts";
import { PairingConnectingStep } from "../../../components/shared/pairing/PairingConnectingStep.tsx";
import { PairingErrorStep } from "../../../components/shared/pairing/PairingErrorStep.tsx";
import { PairingStateView } from "../../../components/shared/pairing/PairingStateView.tsx";
import { FOCUS_COLOR, TEXT_SECONDARY } from "../../../constants/colors.ts";

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

interface Props {
  actorRef: ActorRefFrom<TizenDeviceMachine>;
}

export function TizenPairingStep({ actorRef }: Props) {
  const isInitiatingState = useSelector(actorRef, isInitiating);
  const isWaiting = useSelector(actorRef, isPairingWaitingForUser);
  const isConnecting = useSelector(actorRef, isPairingConnecting);
  const isError = useSelector(actorRef, isPairingError);
  const error = useSelector(actorRef, selectPairingError);

  return (
    <PairingStateView
      title="Samsung TV Pairing"
      states={[
        {
          active: isInitiatingState,
          hints: [],
          content: <PairingConnectingStep brandName="Samsung TV" />,
        },
        { active: isWaiting, hints: [], content: <WaitingStep /> },
        { active: isConnecting, hints: [HINT_BACK], content: null },
        {
          active: isError,
          hints: [HINT_RETRY, HINT_BACK],
          content: <PairingErrorStep error={error} />,
        },
      ]}
    />
  );
}
