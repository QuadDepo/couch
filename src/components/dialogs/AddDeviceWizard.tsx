import { useRef, useCallback, useEffect } from "react";
import { TextAttributes } from "@opentui/core";
import {
  useDialogKeyboard,
  type PromptContext,
} from "@opentui-ui/dialog/react";
import { useMachine, useSelector } from "@xstate/react";
import { fromPromise } from "xstate";
import {
  addDeviceWizardMachine,
  type WizardContext as MachineContext,
  type PairingActionResult,
  type PairingActionInput,
  type SubmitPairingInputData,
  type SubmitPairingInputResult,
} from "../../machines/addDeviceWizardMachine.ts";
import { selectCanGoBack, selectStepState } from "../../machines/addDeviceWizardSelectors.ts";
import { PlatformSelectionStep } from "./wizard/PlatformSelectionStep.tsx";
import { DeviceInfoStep } from "./wizard/DeviceInfoStep.tsx";
import { PairingStepRenderer } from "./wizard/PairingStepRenderer.tsx";
import { CompletionStep } from "./wizard/CompletionStep.tsx";
import { WizardProvider } from "./wizard/WizardProvider.tsx";
import { WizardHeader } from "./wizard/WizardHeader.tsx";
import { createPhilipsAndroidTVHandler } from "../../devices/philips-android-tv/handler.ts";
import { createAndroidTVHandler } from "../../devices/android-tv/handler.ts";
import { createWebOSHandler } from "../../devices/lg-webos/handler.ts";
import type { DeviceHandler } from "../../devices/types.ts";
import type { TVDevice, TVPlatform } from "../../types/index.ts";
import { wrapPlatformCredentials } from "../../devices/factory.ts";

export interface AddDeviceResult {
  device: TVDevice;
}

// Factory to create device handler from pairing input
function createHandlerFromInput(input: PairingActionInput): DeviceHandler | null {
  const tempDevice: TVDevice = {
    id: "temp-pairing",
    name: input.deviceName,
    ip: input.deviceIp,
    platform: input.platform,
    status: "disconnected",
  };
  if (input.platform === "philips-android-tv") return createPhilipsAndroidTVHandler(tempDevice);
  if (input.platform === "android-tv") return createAndroidTVHandler(tempDevice);
  if (input.platform === "lg-webos") return createWebOSHandler(tempDevice);
  return null;
}

export function AddDeviceWizard({
  resolve,
  dismiss,
  dialogId,
}: PromptContext<AddDeviceResult | null>) {
  const handlerRef = useRef<DeviceHandler | null>(null);

  const cleanupHandler = useCallback(() => {
    handlerRef.current?.dispose();
    handlerRef.current = null;
  }, []);

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
      config: ctx.credentials
        ? wrapPlatformCredentials(ctx.platform, ctx.credentials)
        : undefined,
    };
  };

  const [state, send, actorRef] = useMachine(
    addDeviceWizardMachine.provide({
      actors: {
        executePairingAction: fromPromise<PairingActionResult, PairingActionInput>(
          async ({ input }) => {
            try {
              // Reuse existing handler if it has executePairingAction (maintains state between steps)
              if (handlerRef.current?.executePairingAction) {
                return await handlerRef.current.executePairingAction(input.stepId);
              }

              // Otherwise create new handler and use startPairing for first step
              const handler = createHandlerFromInput(input);
              if (!handler) {
                return { error: `Platform ${input.platform} is not yet supported` };
              }
              handlerRef.current = handler;

              if (input.stepId === "start_pairing" && handler.startPairing) {
                const result = await handler.startPairing();
                if (result.error) {
                  return { error: result.error };
                }
                return {};
              } else if (input.stepId === "connecting") {
                await handler.connect();
                return { credentials: null };
              }
              return {};
            } catch (err) {
              return { error: String(err) };
            }
          }
        ),
        submitPairingInput: fromPromise<SubmitPairingInputResult, SubmitPairingInputData>(
          async ({ input }) => {
            if (!handlerRef.current?.submitPairingInput) {
              return { error: "No handler available for input submission" };
            }
            try {
              return await handlerRef.current.submitPairingInput(input.stepId, input.input);
            } catch (err) {
              return { error: String(err) };
            }
          }
        ),
      },
      actions: {
        onComplete: ({ context }) => {
          resolve({ device: buildDevice(context) });
        },
        onCancel: () => {
          cleanupHandler();
          dismiss();
        },
        cleanupHandler: () => {
          cleanupHandler();
        },
      },
    })
  );

  const { error } = state.context;

  useEffect(() => {
    return () => cleanupHandler();
  }, [cleanupHandler]);

  const canGoBack = useSelector(actorRef, selectCanGoBack);
  const stepState = useSelector(actorRef, selectStepState);

  useDialogKeyboard((event) => {
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
    <WizardProvider actorRef={actorRef}>
      <box flexDirection="column" gap={1} paddingLeft={4} paddingRight={4} paddingTop={2} paddingBottom={2}>
        <WizardHeader />

        <box marginTop={1}>
          {stepState === "platformSelection" && <PlatformSelectionStep context={state.context} />}
          {stepState === "deviceInfo" && <DeviceInfoStep context={state.context} />}
          {stepState === "pairing" && <PairingStepRenderer />}
          {stepState === "complete" && <CompletionStep context={state.context} />}
          {stepState === "error" && (
            <box flexDirection="column" gap={1}>
              <text fg="#FF4444" attributes={TextAttributes.BOLD}>
                Error
              </text>
              <text fg="#AAAAAA">{error || "An error occurred"}</text>
              <box marginTop={1} flexDirection="row">
                <text fg="#888888" attributes={TextAttributes.BOLD}>Esc</text>
                <text fg="#666666"> to close, </text>
                <text fg="#888888" attributes={TextAttributes.BOLD}>Ctrl+Bksp</text>
                <text fg="#666666"> to go back and try again</text>
              </box>
            </box>
          )}
        </box>
      </box>
    </WizardProvider>
  );
}
