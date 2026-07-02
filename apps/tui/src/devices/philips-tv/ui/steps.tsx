import {
  FOCUS_COLOR,
  type PhilipsDeviceMachine,
  TEXT_SECONDARY,
  WARNING_COLOR,
} from "@couch/devices";
import {
  isPairingConfirming,
  isPairingConnecting,
  isPairingError,
  isPairingWaitingForPin,
  selectPairingError,
} from "@couch/devices/philips-tv/selectors";
import { TextAttributes } from "@opentui/core";
import { useSelector } from "@xstate/react";
import type { ActorRefFrom } from "xstate";
import { HINT_BACK, HINT_RETRY, HINT_SUBMIT } from "../../../components/shared/pairing/hints.ts";
import { PairingConnectingStep } from "../../../components/shared/pairing/PairingConnectingStep.tsx";
import { PairingErrorStep } from "../../../components/shared/pairing/PairingErrorStep.tsx";
import { PairingStepLayout } from "../../../components/shared/pairing/PairingStepLayout.tsx";

function formatPinDisplay(pin: string): string {
  const filled = pin.split("").map(() => "*");
  const empty = Array(4 - pin.length).fill("_");
  return [...filled, ...empty].join(" ");
}

function EnteringPinStep({ pinInput }: { pinInput: string }) {
  return (
    <>
      <text fg={TEXT_SECONDARY}>A 4-digit PIN code is displayed on your TV.</text>
      <box flexDirection="row" marginTop={1}>
        <text fg={TEXT_SECONDARY}>Enter PIN: </text>
        <text fg={FOCUS_COLOR} attributes={TextAttributes.BOLD}>
          {formatPinDisplay(pinInput)}
        </text>
        {pinInput.length < 4 && (
          <text fg={FOCUS_COLOR} attributes={TextAttributes.BOLD}>
            {" "}
            ←
          </text>
        )}
      </box>
    </>
  );
}

function ConfirmingStep() {
  return <text fg={WARNING_COLOR}>Confirming PIN with TV...</text>;
}

interface Props {
  actorRef: ActorRefFrom<PhilipsDeviceMachine>;
  pinInput: string;
}

export function PhilipsPairingStep({ actorRef, pinInput }: Props) {
  const isStartingPairing = useSelector(actorRef, isPairingConnecting);
  const isEnteringPin = useSelector(actorRef, isPairingWaitingForPin);
  const isConfirmingPairing = useSelector(actorRef, isPairingConfirming);
  const isError = useSelector(actorRef, isPairingError);
  const error = useSelector(actorRef, selectPairingError);

  const getHints = () => {
    if (isStartingPairing || isConfirmingPairing) return [HINT_BACK];
    if (isEnteringPin) return pinInput.length === 4 ? [HINT_SUBMIT, HINT_BACK] : [HINT_BACK];
    if (isError) return [HINT_RETRY, HINT_BACK];
    return [];
  };

  const renderStep = () => {
    if (isStartingPairing) return <PairingConnectingStep brandName="Philips TV" />;
    if (isEnteringPin) return <EnteringPinStep pinInput={pinInput} />;
    if (isConfirmingPairing) return <ConfirmingStep />;
    if (isError) return <PairingErrorStep error={error} />;
    return null;
  };

  return (
    <PairingStepLayout title="Philips TV Pairing" hints={getHints()}>
      {renderStep()}
    </PairingStepLayout>
  );
}
