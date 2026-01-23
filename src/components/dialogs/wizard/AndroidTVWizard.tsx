import { type DialogId, useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useMachine } from "@xstate/react";
import { useEffect, useMemo, useRef } from "react";
import {
  androidTVWizardMachine,
  type WizardOutput,
} from "../../../devices/android-tv/wizard/machine.ts";
import { selectUIState } from "../../../devices/android-tv/wizard/ui.ts";
import { DeviceInfoStep } from "./DeviceInfoStep.tsx";
import { PairingStepRenderer } from "./PairingStepRenderer.tsx";
import { CompletionMessage } from "./CompletionMessage.tsx";
import { WizardHeader } from "./WizardHeader.tsx";

interface AndroidTVWizardProps {
  onComplete: (output: WizardOutput) => void;
  onCancel: () => void;
  dialogId: DialogId;
}

export function AndroidTVWizard({ onComplete, onCancel, dialogId }: AndroidTVWizardProps) {
  const [state, send] = useMachine(androidTVWizardMachine, {
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

  const canGoBack = !isDeviceInfo && !isComplete && !isCancelled && !state.matches("connecting");

  const deviceInfoContext = useMemo(
    () => ({
      deviceName: state.context.deviceName,
      deviceIp: state.context.deviceIp,
      activeField: state.context.activeField,
      error: state.context.error,
    }),
    [
      state.context.deviceName,
      state.context.deviceIp,
      state.context.activeField,
      state.context.error,
    ],
  );

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
      <WizardHeader platform="Android TV" isComplete={isComplete} subtitle="Setup" />

      <box marginTop={1}>
        {isDeviceInfo && <DeviceInfoStep context={deviceInfoContext} />}
        {uiState && !isComplete && <PairingStepRenderer uiState={uiState} />}
        {isComplete && <CompletionMessage deviceName={state.context.deviceName} />}
      </box>
    </box>
  );
}
