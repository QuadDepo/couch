import { useActorRef, useSelector } from "@xstate/react";
import { forwardRef, useImperativeHandle } from "react";
import { CompletionStep } from "../../../components/dialogs/wizard/CompletionStep.tsx";
import { DeviceInfoStep } from "../../../components/dialogs/wizard/DeviceInfoStep.tsx";
import type { PairingFlowHandle, PairingFlowProps } from "../../../components/dialogs/wizard/types.ts";
import { WizardShell } from "../../../components/dialogs/wizard/WizardShell.tsx";
import { useDeviceInfoInput } from "../../../hooks/useDeviceInfoInput.ts";
import type { TVDevice } from "../../../types";
import { inspector } from "../../../utils/inspector.ts";
import { wrapPlatformCredentials } from "../../factory.ts";
import { webosDeviceMachine } from "../machines/device";
import { WebOSPairingStep } from "./steps.tsx";
import {
  isComplete,
  isPairing,
  isPairingError,
  isSetup,
  selectDeviceIp,
  selectDeviceName,
  selectError,
} from "../selectors";

export const WebOSPairingFlow = forwardRef<PairingFlowHandle, PairingFlowProps>(
  function WebOSPairingFlow({ onComplete }, ref) {
    const actorRef = useActorRef(webosDeviceMachine, {
      input: { platform: "lg-webos" as const },
      inspect: inspector?.inspect,
    });

    const deviceInfo = useDeviceInfoInput();

    // Flow state selectors
    const isSetupState = useSelector(actorRef, isSetup);
    const isPairingState = useSelector(actorRef, isPairing);
    const isCompleteState = useSelector(actorRef, isComplete);
    const isErrorState = useSelector(actorRef, isPairingError);

    // Context selectors
    const deviceName = useSelector(actorRef, selectDeviceName);
    const deviceIp = useSelector(actorRef, selectDeviceIp);
    const error = useSelector(actorRef, selectError);

    useImperativeHandle(
      ref,
      () => ({
        canGoBack: () => isSetupState || isPairingState,

        canContinue: () => {
          if (isSetupState) return deviceInfo.isValid;
          if (isErrorState) return true;
          if (isCompleteState) return true;
          return false;
        },

        handleBack: () => {
          if (isPairingState) {
            actorRef.send({ type: "RESET_TO_SETUP" });
            deviceInfo.reset();
            return false; // Stay in flow (went back to setup)
          }
          return true; // Exit to platform selection
        },

        handleContinue: () => {
          if (isSetupState && deviceInfo.isValid) {
            actorRef.send({ type: "SET_DEVICE_INFO", name: deviceInfo.name, ip: deviceInfo.ip });
            return;
          }
          if (isErrorState) {
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
              platform: "lg-webos",
              config: wrapPlatformCredentials("lg-webos", credentials),
            };
            onComplete({ device, actor: actorRef });
          }
        },

        handleChar: (char) => {
          if (isSetupState) {
            deviceInfo.handleChar(char);
          }
        },

        handleBackspace: () => {
          if (isSetupState) {
            deviceInfo.handleBackspace();
          }
        },

        handleTab: () => {
          if (isSetupState) {
            deviceInfo.handleTab();
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
        deviceInfo,
        actorRef,
        onComplete,
      ],
    );

    if (isSetupState) {
      return (
        <WizardShell stepLabel="Device Info" progress="1/3">
          <DeviceInfoStep
            name={deviceInfo.name}
            ip={deviceInfo.ip}
            activeField={deviceInfo.activeField}
            error={error}
          />
        </WizardShell>
      );
    }

    if (isPairingState) {
      return (
        <WizardShell stepLabel="Pairing" progress="2/3">
          <WebOSPairingStep actorRef={actorRef} />
        </WizardShell>
      );
    }

    if (isCompleteState) {
      return (
        <WizardShell stepLabel="Complete" progress="3/3">
          <CompletionStep deviceName={deviceName || deviceInfo.name} />
        </WizardShell>
      );
    }

    return null;
  },
);
