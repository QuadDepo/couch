import { useActorRef, useSelector } from "@xstate/react";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
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
import type { TVDevice } from "../../../types";
import { inspector } from "../../../utils/inspector.ts";
import { wrapPlatformCredentials } from "../../factory.ts";
import { philipsDeviceMachine } from "../machines/device";
import {
  isComplete,
  isPairing,
  isPairingError,
  isPairingWaitingForPin,
  isSetup,
  selectDeviceName,
  selectError,
} from "../selectors";
import { PhilipsPairingStep } from "./steps.tsx";

export const PhilipsPairingFlow = forwardRef<PairingFlowHandle, PairingFlowProps>(
  function PhilipsPairingFlow({ onComplete }, ref) {
    const actorRef = useActorRef(philipsDeviceMachine, {
      input: { platform: "philips-android-tv" as const },
      inspect: inspector?.inspect,
    });

    const deviceInfoRef = useRef<DeviceInfoFieldsRef>(null);

    // PIN input state (Philips-specific)
    const [pinInput, setPinInput] = useState("");

    // Flow state selectors
    const isSetupState = useSelector(actorRef, isSetup);
    const isPairingState = useSelector(actorRef, isPairing);
    const isCompleteState = useSelector(actorRef, isComplete);
    const isErrorState = useSelector(actorRef, isPairingError);
    const isWaitingForPinState = useSelector(actorRef, isPairingWaitingForPin);

    // Context selectors
    const deviceName = useSelector(actorRef, selectDeviceName);
    const error = useSelector(actorRef, selectError);

    useImperativeHandle(
      ref,
      () => ({
        canGoBack: () => isSetupState || isPairingState,

        canContinue: () => {
          if (isSetupState) return deviceInfoRef.current?.isValid ?? false;
          if (isWaitingForPinState) return pinInput.length === 4;
          if (isErrorState) return true;
          if (isCompleteState) return true;
          return false;
        },

        handleBack: () => {
          if (isPairingState) {
            actorRef.send({ type: "RESET_TO_SETUP" });
            setPinInput("");
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
          if (isWaitingForPinState && pinInput.length === 4) {
            actorRef.send({ type: "SUBMIT_PIN", pin: pinInput });
            return;
          }
          if (isErrorState) {
            setPinInput("");
            actorRef.send({ type: "START_PAIRING" });
            return;
          }
          if (isCompleteState) {
            const snapshot = actorRef.getSnapshot();
            const { deviceId, deviceName, deviceIp, credentials } = snapshot.context;
            if (!deviceId) return;

            const device: TVDevice = {
              id: deviceId,
              name: deviceName,
              ip: deviceIp,
              platform: "philips-android-tv",
              config: wrapPlatformCredentials("philips-android-tv", credentials),
            };
            onComplete({ device, actor: actorRef });
          }
        },

        handleChar: (char) => {
          if (isSetupState) {
            deviceInfoRef.current?.handleChar(char);
          } else if (isWaitingForPinState && pinInput.length < 4 && /^\d$/.test(char)) {
            setPinInput((p) => p + char);
          }
        },

        handleBackspace: () => {
          if (isSetupState) {
            deviceInfoRef.current?.handleBackspace();
          } else if (isWaitingForPinState) {
            setPinInput((p) => p.slice(0, -1));
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
        isPairingState,
        isCompleteState,
        isErrorState,
        isWaitingForPinState,
        pinInput,
        actorRef,
        onComplete,
      ],
    );

    if (isSetupState) {
      return (
        <WizardShell stepLabel="Device Info" progress="1/3">
          <DeviceInfoFields ref={deviceInfoRef} error={error} />
        </WizardShell>
      );
    }

    if (isPairingState) {
      return (
        <WizardShell stepLabel="Pairing" progress="2/3">
          <PhilipsPairingStep actorRef={actorRef} pinInput={pinInput} />
        </WizardShell>
      );
    }

    if (isCompleteState) {
      return (
        <WizardShell stepLabel="Complete" progress="3/3">
          <CompletionStep deviceName={deviceName || deviceInfoRef.current?.name || "Device"} />
        </WizardShell>
      );
    }

    return null;
  },
);
