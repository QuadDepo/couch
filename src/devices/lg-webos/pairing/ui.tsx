import { TextAttributes } from "@opentui/core";
import { useSelector } from "@xstate/react";
import { forwardRef, useCallback, useImperativeHandle } from "react";
import type { ActorRefFrom } from "xstate";
import type { PairingHandle } from "../../../machines/pairing/types";
import type { webosPairingMachine } from "./machine";

function InitiatingStep() {
  return (
    <>
      <text fg="#AAAAAA">
        Make sure your LG TV is turned on and connected to the same network.
      </text>
      <text fg="#FFAA00" marginTop={1}>
        Connecting to TV...
      </text>
    </>
  );
}

function WaitingStep() {
  return (
    <>
      <text fg="#AAAAAA">A pairing request has been sent to your TV.</text>
      <text fg="#00AAFF" marginTop={1} attributes={TextAttributes.BOLD}>
        Please accept the pairing request on your TV screen.
      </text>
      <text fg="#666666" marginTop={1}>
        Waiting for confirmation...
      </text>
    </>
  );
}

function SuccessStep() {
  return (
    <>
      <text fg="#00FF00">Your LG TV has been paired successfully!</text>
      <text fg="#AAAAAA" marginTop={1}>
        The client key has been stored for future connections.
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
  actorRef: ActorRefFrom<typeof webosPairingMachine>;
}

export const WebOSPairingUI = forwardRef<PairingHandle, Props>(
  function WebOSPairingUI({ actorRef }, ref) {
    const isInitiating = useSelector(actorRef, (state) =>
      state.matches({ connecting: "initiating" }),
    );
    const isWaiting = useSelector(actorRef, (state) =>
      state.matches({ connecting: "waitingForConfirmation" }),
    );
    const isSuccess = useSelector(actorRef, (state) => state.matches("success"));
    const isError = useSelector(actorRef, (state) => state.matches("error"));
    const error = useSelector(actorRef, (state) => state.context.error);

    const handleSubmit = useCallback(() => {
      if (isError) {
        actorRef.send({ type: "SUBMIT" });
      }
    }, [actorRef, isError]);

    useImperativeHandle(
      ref,
      () => ({
        handleChar: () => {},
        handleBackspace: () => {},
        handleSubmit,
      }),
      [handleSubmit],
    );

    return (
      <box flexDirection="column" gap={1}>
        <text fg="#FFFFFF" attributes={TextAttributes.BOLD}>
          WebOS TV Pairing
        </text>

        {isInitiating && <InitiatingStep />}
        {isWaiting && <WaitingStep />}
        {isSuccess && <SuccessStep />}
        {isError && <ErrorStep error={error} />}
      </box>
    );
  },
);
