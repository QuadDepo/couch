import { TextAttributes } from "@opentui/core";
import { type PromptContext, useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useMachine, useSelector } from "@xstate/react";
import { useCallback, useRef } from "react";
import { DIM_COLOR, ERROR_COLOR } from "../../constants/colors.ts";
import { wrapPlatformCredentials } from "../../devices/factory.ts";
import {
  addDeviceWizardMachine,
  type WizardContext as MachineContext,
} from "../../machines/addDeviceWizardMachine.ts";
import { selectStepState } from "../../machines/addDeviceWizardSelectors.ts";
import type { TVDevice } from "../../types/index.ts";
import { CompletionStep } from "./wizard/CompletionStep.tsx";
import { DeviceInfoStep, type DeviceInfoStepHandle } from "./wizard/DeviceInfoStep.tsx";
import { type PairingStepHandle, PairingStepRenderer } from "./wizard/PairingStepRenderer.tsx";
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
  const currentState = useSelector(actorRef, selectStepState);

  const handleDeviceInfoSubmit = useCallback(
    (name: string, ip: string) => {
      send({ type: "SET_DEVICE_INFO", name, ip });
    },
    [send],
  );

  const handleBack = useCallback(() => {
    if (currentState === "platformSelection") return;

    if (currentState === "connection") {
      const handled = pairingRef.current?.handleBack();
      if (handled) return;
    }

    send({ type: "BACK" });
  }, [currentState, send]);

  useDialogKeyboard((event) => {
    if (event.name === "backspace" && event.ctrl) {
      handleBack();
      return;
    }

    const refMap = {
      deviceInfo: deviceInfoRef,
      connection: pairingRef,
    } as const;

    const activeRef = refMap[currentState as keyof typeof refMap];

    if (activeRef?.current) {
      switch (event.name) {
        case "return":
          activeRef.current.handleSubmit();
          return;
        case "backspace":
          activeRef.current.handleBackspace();
          return;
        case "tab":
          if ("handleTab" in activeRef.current) {
            activeRef.current.handleTab();
          }
          return;
        case "escape":
          send({ type: "CANCEL" });
          return;
        default:
          if (event.sequence?.length === 1) {
            activeRef.current.handleChar(event.sequence);
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

  const renderStep = () => {
    switch (currentState) {
      case "platformSelection":
        return <PlatformSelectionStep context={state.context} />;
      case "deviceInfo":
        return (
          <DeviceInfoStep
            ref={deviceInfoRef}
            initialName={state.context.deviceName}
            initialIp={state.context.deviceIp}
            error={error}
            onSubmit={handleDeviceInfoSubmit}
          />
        );
      case "connection":
        return <PairingStepRenderer ref={pairingRef} />;
      case "complete":
        return <CompletionStep context={state.context} />;
      case "error":
        return (
          <box flexDirection="column" gap={1}>
            <text fg={ERROR_COLOR} attributes={TextAttributes.BOLD}>
              Error
            </text>
            <text fg={DIM_COLOR}>{error || "An error occurred"}</text>
          </box>
        );
      default:
        return null;
    }
  };

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
        <box marginTop={1}>{renderStep()}</box>
      </box>
    </WizardProvider>
  );
}
