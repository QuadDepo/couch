import { type DialogId, useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useMachine, useSelector } from "@xstate/react";
import { useEffect, useRef } from "react";
import { type WizardOutput, webOSWizardMachine } from "../../../devices/lg-webos/wizard/machine.ts";
import { selectUIState } from "../../../devices/lg-webos/wizard/ui.ts";
import { CompletionMessage } from "./CompletionMessage.tsx";
import { DeviceInfoStep } from "./DeviceInfoStep.tsx";
import { PairingStepRenderer } from "./PairingStepRenderer.tsx";
import { WizardHeader } from "./WizardHeader.tsx";

interface WebOSWizardProps {
  onComplete: (output: WizardOutput) => void;
  onCancel: () => void;
  dialogId: DialogId;
}

export function WebOSWizard({ onComplete, onCancel, dialogId }: WebOSWizardProps) {
  const [state, send, actorRef] = useMachine(webOSWizardMachine, {
    input: { deviceName: "", deviceIp: "" },
  });

  const uiState = selectUIState(state);
  const isDeviceInfo = state.matches("deviceInfo");
  const isConnecting = state.matches("connecting");
  const isComplete = state.matches("complete");
  const isCancelled = state.matches("cancelled");

  // Store output in ref so we can access it when user dismisses completion screen
  const outputRef = useRef<WizardOutput | null>(null);

  useEffect(() => {
    if (isComplete && state.output) {
      outputRef.current = state.output;
    }
  }, [isComplete, state.output]);

  // Handle cancelled state
  useEffect(() => {
    if (isCancelled) {
      onCancel();
    }
  }, [isCancelled, onCancel]);

  const canGoBack = !isDeviceInfo && !isComplete && !isCancelled && !isConnecting;

  const deviceName = useSelector(actorRef, (state) => state.context.deviceName);
  const deviceIp = useSelector(actorRef, (state) => state.context.deviceIp);
  const activeField = useSelector(actorRef, (state) => state.context.activeField);
  const error = useSelector(actorRef, (state) => state.context.error);

  useDialogKeyboard((event) => {
    // When complete, Enter or Esc closes the dialog with the result
    if (isComplete) {
      if (event.name === "return" || event.name === "escape") {
        if (outputRef.current) {
          onComplete(outputRef.current);
        }
      }
      return;
    }

    switch (event.name) {
      case "return":
        send({ type: "SUBMIT" });
        break;
      case "escape":
        send({ type: "CANCEL" });
        break;
      case "tab":
        send({ type: "TAB" });
        break;
      case "backspace":
        if (event.ctrl && canGoBack) {
          send({ type: "BACK" });
        } else {
          send({ type: "BACKSPACE" });
        }
        break;
      default:
        if (event.sequence?.length === 1) {
          send({ type: "CHAR_INPUT", char: event.sequence });
        }
    }
  }, dialogId);

  return (
    <box flexDirection="column" gap={1}>
      <WizardHeader platform="LG WebOS" isComplete={isComplete} />

      <box marginTop={1}>
        {(isDeviceInfo || isConnecting) && (
          <DeviceInfoStep
            deviceName={deviceName}
            deviceIp={deviceIp}
            activeField={activeField}
            error={error}
          />
        )}
        {uiState && !isComplete && <PairingStepRenderer uiState={uiState} />}
        {isComplete && <CompletionMessage deviceName={deviceName} />}
      </box>
    </box>
  );
}
