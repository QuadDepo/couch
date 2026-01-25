import { TextAttributes } from "@opentui/core";
import { type PromptContext, useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useMachine, useSelector } from "@xstate/react";
import { useCallback, useRef } from "react";
import { wrapPlatformCredentials } from "../../devices/factory.ts";
import {
  addDeviceWizardMachine,
  type WizardContext as MachineContext,
} from "../../machines/addDeviceWizardMachine.ts";
import { selectStepState } from "../../machines/addDeviceWizardSelectors.ts";
import type { TVDevice } from "../../types/index.ts";
import { CompletionStep } from "./wizard/CompletionStep.tsx";
import { DeviceInfoStep, type DeviceInfoStepHandle } from "./wizard/DeviceInfoStep.tsx";
import { PairingStepRenderer, type PairingStepHandle } from "./wizard/PairingStepRenderer.tsx";
import { PlatformSelectionStep } from "./wizard/PlatformSelectionStep.tsx";
import { WizardHeader } from "./wizard/WizardHeader.tsx";
import { WizardProvider } from "./wizard/WizardProvider.tsx";

export interface AddDeviceResult {
  device: TVDevice;
}

export function AddDeviceWizard({
  resolve,
  dismiss,
  dialogId,
}: PromptContext<AddDeviceResult | null>) {
  const deviceInfoRef = useRef<DeviceInfoStepHandle>(null);
  const pairingRef = useRef<PairingStepHandle>(null);

  const buildDevice = (ctx: MachineContext): TVDevice => {
    if (!ctx.platform) {
      throw new Error("Platform not selected");
    }

    return {
      id: crypto.randomUUID(),
      name: ctx.deviceName,
      ip: ctx.deviceIp,
      platform: ctx.platform,
      status: "disconnected",
      config: ctx.credentials ? wrapPlatformCredentials(ctx.platform, ctx.credentials) : undefined,
    };
  };

  const [state, send, actorRef] = useMachine(
    addDeviceWizardMachine.provide({
      actions: {
        onComplete: ({ context }) => {
          resolve({ device: buildDevice(context) });
        },
        onCancel: () => {
          dismiss();
        },
      },
    }),
  );

  const { error } = state.context;
  const stepState = useSelector(actorRef, selectStepState);

  const handleDeviceInfoSubmit = useCallback(
    (name: string, ip: string) => {
      send({ type: "SET_DEVICE_INFO", name, ip });
    },
    [send],
  );

  useDialogKeyboard((event) => {
    if (stepState === "deviceInfo") {
      switch (event.name) {
        case "return":
          deviceInfoRef.current?.handleSubmit();
          return;
        case "tab":
          deviceInfoRef.current?.handleTab();
          return;
        case "backspace":
          deviceInfoRef.current?.handleBackspace();
          return;
        case "escape":
          send({ type: "CANCEL" });
          return;
        default:
          if (event.sequence?.length === 1) {
            deviceInfoRef.current?.handleChar(event.sequence);
          }
          return;
      }
    }

    if (stepState === "connection") {
      switch (event.name) {
        case "return":
          pairingRef.current?.handleSubmit();
          return;
        case "backspace":
          pairingRef.current?.handleBackspace();
          return;
        case "escape":
          send({ type: "CANCEL" });
          return;
        default:
          if (event.sequence?.length === 1) {
            pairingRef.current?.handleChar(event.sequence);
          }
          return;
      }
    }

    switch (event.name) {
      case "up":
        send({ type: "ARROW_UP" });
        break;
      case "down":
        send({ type: "ARROW_DOWN" });
        break;
      case "return":
        send({ type: "SUBMIT" });
        break;
      case "escape":
        send({ type: "CANCEL" });
        break;
    }
  }, dialogId);

  return (
    <WizardProvider actorRef={actorRef}>
      <box
        flexDirection="column"
        gap={1}
        paddingLeft={4}
        paddingRight={4}
        paddingTop={2}
        paddingBottom={2}
      >
        <WizardHeader />

        <box marginTop={1}>
          {stepState === "platformSelection" && <PlatformSelectionStep context={state.context} />}
          {stepState === "deviceInfo" && (
            <DeviceInfoStep
              ref={deviceInfoRef}
              error={error}
              onSubmit={handleDeviceInfoSubmit}
            />
          )}
          {stepState === "connection" && <PairingStepRenderer ref={pairingRef} />}
          {stepState === "complete" && <CompletionStep context={state.context} />}
          {stepState === "error" && (
            <box flexDirection="column" gap={1}>
              <text fg="#FF4444" attributes={TextAttributes.BOLD}>
                Error
              </text>
              <text fg="#AAAAAA">{error || "An error occurred"}</text>
            </box>
          )}
        </box>
      </box>
    </WizardProvider>
  );
}
