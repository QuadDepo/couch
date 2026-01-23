import { TextAttributes } from "@opentui/core";
import { type DialogId, useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useMachine } from "@xstate/react";
import { useEffect, useRef } from "react";
import { type WizardOutput, webOSWizardMachine } from "../../../devices/lg-webos/wizard/machine.ts";
import { selectUIState } from "../../../devices/lg-webos/wizard/ui.ts";
import { DeviceInfoStep } from "./DeviceInfoStep.tsx";
import { PairingStepRenderer } from "./PairingStepRenderer.tsx";

interface WebOSWizardProps {
  onComplete: (output: WizardOutput) => void;
  onCancel: () => void;
  dialogId: DialogId;
}

export function WebOSWizard({ onComplete, onCancel, dialogId }: WebOSWizardProps) {
  const [state, send] = useMachine(webOSWizardMachine, {
    input: { deviceName: "", deviceIp: "" },
  });

  const uiState = selectUIState(state);
  const isDeviceInfo = state.matches("deviceInfo");
  const isConnecting = state.matches("connecting");
  const isComplete = state.matches("complete");
  const isCancelled = state.matches("cancelled");

  // Store output in ref so we can access it when user dismisses completion screen
  const outputRef = useRef<WizardOutput | null>(null);
  if (isComplete && state.output) {
    outputRef.current = state.output;
  }

  // Handle cancelled state
  useEffect(() => {
    if (isCancelled) {
      onCancel();
    }
  }, [isCancelled, onCancel]);

  const canGoBack = !isDeviceInfo && !isComplete && !isCancelled && !isConnecting;

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
            context={{
              deviceName: state.context.deviceName,
              deviceIp: state.context.deviceIp,
              activeField: state.context.activeField,
              error: state.context.error,
            }}
          />
        )}
        {uiState && !isComplete && <PairingStepRenderer uiState={uiState} />}
        {isComplete && <CompletionMessage deviceName={state.context.deviceName} />}
      </box>
    </box>
  );
}

function WizardHeader({ platform, isComplete }: { platform: string; isComplete: boolean }) {
  return (
    <>
      <box flexDirection="row" justifyContent="space-between">
        <text fg="#00AAFF" attributes={TextAttributes.BOLD}>
          Add Device
        </text>
        <text fg="#666666">{platform}</text>
      </box>
      <text fg="#888888">{isComplete ? "Complete" : "Pairing"}</text>
    </>
  );
}

function CompletionMessage({ deviceName }: { deviceName: string }) {
  return (
    <box flexDirection="column" gap={1}>
      <text fg="#00FF00" attributes={TextAttributes.BOLD}>
        Device Added Successfully!
      </text>
      <text fg="#FFFFFF">"{deviceName}" has been added and configured.</text>
      <box marginTop={1} flexDirection="row">
        <text fg="#888888" attributes={TextAttributes.BOLD}>
          Enter
        </text>
        <text fg="#666666"> or </text>
        <text fg="#888888" attributes={TextAttributes.BOLD}>
          Esc
        </text>
        <text fg="#666666"> to close</text>
      </box>
    </box>
  );
}
