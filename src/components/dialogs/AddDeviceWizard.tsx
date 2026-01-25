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
import {
  isCompleteState,
  isConnectionState,
  isDeviceInfoState,
  isErrorState,
  isPlatformSelectionState,
  selectError,
} from "../../machines/addDeviceWizardSelectors.ts";
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

  const isPlatformSelection = useSelector(actorRef, isPlatformSelectionState);
  const isDeviceInfo = useSelector(actorRef, isDeviceInfoState);
  const isConnection = useSelector(actorRef, isConnectionState);
  const isComplete = useSelector(actorRef, isCompleteState);
  const isError = useSelector(actorRef, isErrorState);
  const error = useSelector(actorRef, selectError);

  const handleDeviceInfoSubmit = useCallback(
    (name: string, ip: string) => {
      send({ type: "SET_DEVICE_INFO", name, ip });
    },
    [send],
  );

  const handleBack = useCallback(() => {
    if (isPlatformSelection) return;

    if (isConnection) {
      const handled = pairingRef.current?.handleBack();
      if (handled) return;
    }

    send({ type: "BACK" });
  }, [isPlatformSelection, isConnection, send]);

  const getActiveRef = () => {
    if (isDeviceInfo) return deviceInfoRef;
    if (isConnection) return pairingRef;
    return null;
  };

  useDialogKeyboard((event) => {
    if (event.name === "backspace" && event.ctrl) {
      handleBack();
      return;
    }

    const activeRef = getActiveRef();

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
    if (isPlatformSelection) return <PlatformSelectionStep context={state.context} />;
    if (isDeviceInfo) {
      return (
        <DeviceInfoStep
          ref={deviceInfoRef}
          initialName={state.context.deviceName}
          initialIp={state.context.deviceIp}
          error={error}
          onSubmit={handleDeviceInfoSubmit}
        />
      );
    }
    if (isConnection) return <PairingStepRenderer ref={pairingRef} />;
    if (isComplete) return <CompletionStep context={state.context} />;
    if (isError) {
      return (
        <box flexDirection="column" gap={1}>
          <text fg={ERROR_COLOR} attributes={TextAttributes.BOLD}>
            Error
          </text>
          <text fg={DIM_COLOR}>{error || "An error occurred"}</text>
        </box>
      );
    }
    return null;
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
