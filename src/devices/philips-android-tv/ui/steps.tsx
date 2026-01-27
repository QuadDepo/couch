import { TextAttributes } from "@opentui/core";
import { useSelector } from "@xstate/react";
import type { ActorRefFrom } from "xstate";
import { WizardHints } from "../../../components/dialogs/wizard/WizardHints.tsx";
import { DIM_COLOR, ERROR_COLOR, FOCUS_COLOR } from "../../../constants/colors.ts";
import type { philipsDeviceMachine } from "../machines/device";
import {
  isPairingConfirming,
  isPairingConnecting,
  isPairingError,
  isPairingWaitingForPin,
  selectPairingError,
} from "../selectors";

const HINT_SUBMIT = { key: "Enter", label: "to submit" };
const HINT_RETRY = { key: "Enter", label: "to retry" };
const HINT_BACK = { key: "Ctrl+Bs", label: "to go back" };

function StartingPairingStep() {
  return (
    <>
      <text fg={DIM_COLOR}>
        Make sure your Philips TV is turned on and connected to the same network.
      </text>
      <text fg="#FFAA00" marginTop={1}>
        Initiating pairing...
      </text>
    </>
  );
}

function EnteringPinStep({ pinInput }: { pinInput: string }) {
  const formatPinDisplay = (pin: string): string => {
    const filled = pin.split("").map(() => "*");
    const empty = Array(4 - pin.length).fill("_");
    return [...filled, ...empty].join(" ");
  };

  return (
    <>
      <text fg={DIM_COLOR}>A 4-digit PIN code is displayed on your TV.</text>
      <box flexDirection="row" marginTop={1}>
        <text fg={DIM_COLOR}>Enter PIN: </text>
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
  return <text fg="#FFAA00">Confirming PIN with TV...</text>;
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
  actorRef: ActorRefFrom<typeof philipsDeviceMachine>;
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
      <text attributes={TextAttributes.BOLD}>Philips TV Pairing</text>
      {renderStep()}
      {hints.length > 0 && <WizardHints hints={hints} />}
    </box>
  );
}
