import {
  androidTVDeviceMachine,
  inspector,
  type TVDevice,
  wrapPlatformCredentials,
} from "@couch/devices";
import {
  isComplete,
  isPairing,
  isPairingError,
  isPairingInstructions,
  isSetup,
  selectDeviceName,
  selectError,
} from "@couch/devices/android-tv/selectors";
import { useActorRef, useSelector } from "@xstate/react";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { CompletionStep } from "../../../components/dialogs/wizard/CompletionStep.tsx";
import type {
  PairingFlowHandle,
  PairingFlowProps,
} from "../../../components/dialogs/wizard/types.ts";
import { WizardShell } from "../../../components/dialogs/wizard/WizardShell.tsx";
import {
  DeviceInfoFields,
  type DeviceInfoFieldsRef,
} from "../../../components/shared/DeviceInfoFields.tsx";
import { AndroidTVInstructionsStep, AndroidTVPairingStep } from "./steps.tsx";

export const AndroidTVPairingFlow = forwardRef<PairingFlowHandle, PairingFlowProps>(
  function AndroidTVPairingFlow({ onComplete }, ref) {
    const actorRef = useActorRef(androidTVDeviceMachine, {
      input: { platform: "android-tv" as const },
      inspect: inspector?.inspect,
    });

    const deviceInfoRef = useRef<DeviceInfoFieldsRef>(null);

    // Flow state selectors
    const isSetupState = useSelector(actorRef, isSetup);
    const isInstructionsState = useSelector(actorRef, isPairingInstructions);
    const isPairingState = useSelector(actorRef, isPairing);
    const isCompleteState = useSelector(actorRef, isComplete);
    const isErrorState = useSelector(actorRef, isPairingError);

    // Context selectors
    const deviceName = useSelector(actorRef, selectDeviceName);
    const error = useSelector(actorRef, selectError);

    useImperativeHandle(
      ref,
      () => ({
        canGoBack: () => isSetupState || isPairingState,

        canContinue: () => {
          if (isSetupState) return deviceInfoRef.current?.isValid ?? false;
          if (isInstructionsState) return true;
          if (isErrorState) return true;
          if (isCompleteState) return true;
          return false;
        },

        handleBack: () => {
          if (isInstructionsState) {
            actorRef.send({ type: "BACK_INSTRUCTION" });
            return false; // Stay in flow
          }
          if (isPairingState) {
            actorRef.send({ type: "RESET_TO_SETUP" });
            deviceInfoRef.current?.reset();
            return false; // Stay in flow (went back to setup)
          }
          return true; // Exit to platform selection
        },

        handleContinue: () => {
          const info = deviceInfoRef.current;
          if (isSetupState && info?.isValid) {
            actorRef.send({ type: "SET_DEVICE_INFO", name: info.name, ip: info.ip });
            return;
          }
          if (isInstructionsState) {
            actorRef.send({ type: "CONTINUE_INSTRUCTION" });
            return;
          }
          if (isErrorState) {
            actorRef.send({ type: "START_PAIRING" });
            return;
          }
          if (isCompleteState) {
            const snapshot = actorRef.getSnapshot();
            const { deviceId, deviceName, deviceIp } = snapshot.context;
            if (!deviceId) return;

            const device: TVDevice = {
              id: deviceId,
              name: deviceName,
              ip: deviceIp,
              platform: "android-tv",
              config: wrapPlatformCredentials("android-tv", undefined),
            };
            onComplete({ device, actor: actorRef });
          }
        },

        handleChar: (char) => {
          if (isSetupState) {
            deviceInfoRef.current?.handleChar(char);
          }
        },

        handleBackspace: () => {
          if (isSetupState) {
            deviceInfoRef.current?.handleBackspace();
          }
        },

        handleTab: () => {
          if (isSetupState) {
            deviceInfoRef.current?.handleTab();
          }
        },

        cleanup: () => {
          actorRef.stop();
        },
      }),
      [
        isSetupState,
        isInstructionsState,
        isPairingState,
        isCompleteState,
        isErrorState,
        actorRef,
        onComplete,
      ],
    );

    if (isSetupState) {
      return (
        <WizardShell stepLabel="Device Info" progress="1/4">
          <DeviceInfoFields ref={deviceInfoRef} error={error} />
        </WizardShell>
      );
    }

    if (isInstructionsState) {
      return (
        <WizardShell stepLabel="Setup Instructions" progress="2/4">
          <AndroidTVInstructionsStep actorRef={actorRef} />
        </WizardShell>
      );
    }

    if (isPairingState) {
      return (
        <WizardShell stepLabel="Pairing" progress="3/4">
          <AndroidTVPairingStep actorRef={actorRef} />
        </WizardShell>
      );
    }

    if (isCompleteState) {
      return (
        <WizardShell stepLabel="Complete" progress="4/4">
          <CompletionStep deviceName={deviceName || deviceInfoRef.current?.name || "Device"} />
        </WizardShell>
      );
    }

    return null;
  },
);
