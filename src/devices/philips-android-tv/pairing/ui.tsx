import { TextAttributes } from "@opentui/core";
import { useSelector } from "@xstate/react";
import { forwardRef, useCallback, useImperativeHandle, useState } from "react";
import type { ActorRefFrom } from "xstate";
import { WizardHints } from "../../../components/dialogs/wizard/WizardHints.tsx";
import { ACTIVE_COLOR, DIM_COLOR, ERROR_COLOR, FOCUS_COLOR } from "../../../constants/colors.ts";
import type { PairingHandle } from "../../../machines/pairing/types";
import type { philipsPairingMachine } from "./machine";
import {
  isConfirmingPairingState,
  isEnteringPinState,
  isErrorState,
  isStartingPairingState,
  isSuccessState,
  selectError,
} from "./selectors";

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

function EnteringPinStep({ pinInput, error }: { pinInput: string; error?: string }) {
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
      {error && (
        <text fg={ERROR_COLOR} marginTop={1}>
          {error}
        </text>
      )}
    </>
  );
}

function ConfirmingStep() {
  return <text fg="#FFAA00">Confirming PIN with TV...</text>;
}

function SuccessStep() {
  return (
    <>
      <text fg={ACTIVE_COLOR}>Your Philips TV has been paired successfully!</text>
      <text fg={DIM_COLOR} marginTop={1}>
        Credentials have been stored for future connections.
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
  actorRef: ActorRefFrom<typeof philipsPairingMachine>;
}

export const PhilipsPairingUI = forwardRef<PairingHandle, Props>(function PhilipsPairingUI(
  { actorRef },
  ref,
) {
  const [pinInput, setPinInput] = useState("");

  const isStartingPairing = useSelector(actorRef, isStartingPairingState);
  const isEnteringPin = useSelector(actorRef, isEnteringPinState);
  const isConfirmingPairing = useSelector(actorRef, isConfirmingPairingState);
  const isSuccess = useSelector(actorRef, isSuccessState);
  const isError = useSelector(actorRef, isErrorState);
  const error = useSelector(actorRef, selectError);

  const handleChar = useCallback(
    (char: string) => {
      if (pinInput.length < 4 && /^\d$/.test(char)) {
        setPinInput((prev) => prev + char);
      }
    },
    [pinInput.length],
  );

  const handleBackspace = useCallback(() => {
    setPinInput((prev) => prev.slice(0, -1));
  }, []);

  const handleSubmit = useCallback(() => {
    if (isEnteringPin && pinInput.length === 4) {
      actorRef.send({ type: "SUBMIT_PIN", pin: pinInput });
      return true;
    }
    if (isError) {
      actorRef.send({ type: "RETRY" });
      return true;
    }
    return false;
  }, [actorRef, isEnteringPin, isError, pinInput]);

  const handleBack = useCallback(() => {
    return false;
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      handleChar,
      handleBackspace,
      handleSubmit,
      handleBack,
    }),
    [handleChar, handleBackspace, handleSubmit, handleBack],
  );

  const getHints = () => {
    if (isStartingPairing || isConfirmingPairing) return [HINT_BACK];
    if (isEnteringPin) return [HINT_SUBMIT, HINT_BACK];
    if (isError) return [HINT_RETRY, HINT_BACK];
    return [];
  };

  const renderStep = () => {
    if (isStartingPairing) return <StartingPairingStep />;
    if (isEnteringPin) return <EnteringPinStep pinInput={pinInput} error={error} />;
    if (isConfirmingPairing) return <ConfirmingStep />;
    if (isSuccess) return <SuccessStep />;
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
});
