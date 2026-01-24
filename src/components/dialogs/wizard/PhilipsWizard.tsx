import { type DialogId, useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useMachine, useSelector } from "@xstate/react";
import { useEffect, useRef } from "react";
import {
  philipsWizardMachine,
  type WizardOutput,
} from "../../../devices/philips-android-tv/wizard/machine.ts";
import { selectUIState } from "../../../devices/philips-android-tv/wizard/ui.ts";
import { CompletionMessage } from "./CompletionMessage.tsx";
import { DeviceInfoStep } from "./DeviceInfoStep.tsx";
import { PairingStepRenderer } from "./PairingStepRenderer.tsx";
import { WizardHeader } from "./WizardHeader.tsx";

interface PhilipsWizardProps {
  onComplete: (output: WizardOutput) => void;
  onCancel: () => void;
  dialogId: DialogId;
}

export function PhilipsWizard({ onComplete, onCancel, dialogId }: PhilipsWizardProps) {
  const [state, send, actorRef] = useMachine(philipsWizardMachine, {
    input: { deviceName: "", deviceIp: "" },
  });

  const uiState = selectUIState(state);
  const isDeviceInfo = state.matches("deviceInfo");
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

  const canGoBack =
    !isDeviceInfo &&
    !isComplete &&
    !isCancelled &&
    !state.matches("requestingPin") &&
    !state.matches("validatingPin");

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
      <WizardHeader platform="Philips Android TV" isComplete={isComplete} />

      <box marginTop={1}>
        {isDeviceInfo && (
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
