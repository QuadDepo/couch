import { TextAttributes } from "@opentui/core";
import { useSelector } from "@xstate/react";
import { forwardRef, useCallback, useImperativeHandle, useState } from "react";
import type { ActorRefFrom } from "xstate";
import type { PairingHandle } from "../../../machines/pairing/types";
import type { philipsPairingMachine } from "./machine";

function EnteringPinStep({ pinInput, error }: { pinInput: string; error?: string }) {
  const formatPinDisplay = (pin: string): string => {
    const filled = pin.split("").map(() => "*");
    const empty = Array(4 - pin.length).fill("_");
    return [...filled, ...empty].join(" ");
  };

  return (
    <>
      <text fg="#AAAAAA">A 4-digit PIN code is displayed on your TV.</text>
      <box flexDirection="row" marginTop={1}>
        <text fg="#AAAAAA">Enter PIN: </text>
        <text fg="#00AAFF" attributes={TextAttributes.BOLD}>
          {formatPinDisplay(pinInput)}
        </text>
        {pinInput.length < 4 && (
          <text fg="#00AAFF" attributes={TextAttributes.BOLD}>
            {" "}
            ←
          </text>
        )}
      </box>
      {error && (
        <text fg="#FF4444" marginTop={1}>
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
      <text fg="#00FF00">Your Philips TV has been paired successfully!</text>
      <text fg="#AAAAAA" marginTop={1}>
        Credentials have been stored for future connections.
      </text>
    </>
  );
}

function ErrorStep({ error }: { error?: string }) {
  return (
    <>
      <text fg="#FF4444">{error || "Connection failed"}</text>
      <text fg="#AAAAAA" marginTop={1}>
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

  const isStarting = useSelector(actorRef, (state) => state.matches("startingPairing"));
  const isEnteringPin = useSelector(actorRef, (state) => state.matches("enteringPin"));
  const isConfirming = useSelector(actorRef, (state) => state.matches("confirmingPairing"));
  const isSuccess = useSelector(actorRef, (state) => state.matches("success"));
  const isError = useSelector(actorRef, (state) => state.matches("error"));
  const error = useSelector(actorRef, (state) => state.context.error);

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
    } else if (isError) {
      actorRef.send({ type: "RETRY" });
    }
  }, [actorRef, isEnteringPin, isError, pinInput]);

  useImperativeHandle(
    ref,
    () => ({
      handleChar,
      handleBackspace,
      handleSubmit,
    }),
    [handleChar, handleBackspace, handleSubmit],
  );

  return (
    <box flexDirection="column" gap={1}>
      <text fg="#FFFFFF" attributes={TextAttributes.BOLD}>
        Philips TV Pairing
      </text>

      {(isStarting || isEnteringPin) && <EnteringPinStep pinInput={pinInput} error={error} />}
      {isConfirming && <ConfirmingStep />}
      {isSuccess && <SuccessStep />}
      {isError && <ErrorStep error={error} />}
    </box>
  );
});
