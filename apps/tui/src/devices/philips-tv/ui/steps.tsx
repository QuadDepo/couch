import {
  ERROR_COLOR,
  FOCUS_COLOR,
  type PhilipsDeviceMachine,
  TEXT_PRIMARY,
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
import { HintGroup } from "../../../components/shared/HintGroup.tsx";

const HINT_SUBMIT = { key: "Enter", label: "to submit" };
const HINT_RETRY = { key: "Enter", label: "to retry" };
const HINT_BACK = { key: "Ctrl+Bs", label: "to go back" };

function formatPinDisplay(pin: string): string {
  const filled = pin.split("").map(() => "*");
  const empty = Array(4 - pin.length).fill("_");
  return [...filled, ...empty].join(" ");
}

function StartingPairingStep() {
  return (
    <>
      <text fg={TEXT_SECONDARY}>
        Make sure your Philips TV is turned on and connected to the same network.
      </text>
      <text fg={WARNING_COLOR} marginTop={1}>
        Initiating pairing...
      </text>
    </>
  );
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
    if (isStartingPairing) return <StartingPairingStep />;
    if (isEnteringPin) return <EnteringPinStep pinInput={pinInput} />;
    if (isConfirmingPairing) return <ConfirmingStep />;
    if (isError) return <ErrorStep error={error} />;
    return null;
  };

  const hints = getHints();

  return (
    <box flexDirection="column" gap={1}>
      <text fg={TEXT_PRIMARY} attributes={TextAttributes.BOLD}>
        Philips TV Pairing
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
