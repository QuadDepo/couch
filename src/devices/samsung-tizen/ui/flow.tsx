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
import type { TVDevice } from "../../../types";
import { inspector } from "../../../utils/inspector.ts";
import { wrapPlatformCredentials } from "../../factory.ts";
import { tizenDeviceMachine } from "../machines/device";
import {
  isComplete,
  isPairing,
  isPairingError,
  isSetup,
  selectDeviceName,
  selectError,
} from "../selectors";
import { TizenPairingStep } from "./steps.tsx";

export const TizenPairingFlow = forwardRef<PairingFlowHandle, PairingFlowProps>(
  function TizenPairingFlow({ onComplete }, ref) {
    const actorRef = useActorRef(tizenDeviceMachine, {
      input: { platform: "samsung-tizen" as const },
      inspect: inspector?.inspect,
    });

    const deviceInfoRef = useRef<DeviceInfoFieldsRef>(null);

    const isSetupState = useSelector(actorRef, isSetup);
    const isPairingState = useSelector(actorRef, isPairing);
    const isCompleteState = useSelector(actorRef, isComplete);
    const isErrorState = useSelector(actorRef, isPairingError);

    const deviceName = useSelector(actorRef, selectDeviceName);
    const error = useSelector(actorRef, selectError);

    useImperativeHandle(
      ref,
      () => ({
        canGoBack: () => isSetupState || isPairingState,

        canContinue: () => {
          if (isSetupState) return deviceInfoRef.current?.isValid ?? false;
          if (isErrorState) return true;
          if (isCompleteState) return true;
          return false;
        },

        handleBack: () => {
          if (isPairingState) {
            actorRef.send({ type: "RESET_TO_SETUP" });
            deviceInfoRef.current?.reset();
            return false;
          }
          return true;
        },

        handleContinue: () => {
          const info = deviceInfoRef.current;
          if (isSetupState && info?.isValid) {
            actorRef.send({ type: "SET_DEVICE_INFO", name: info.name, ip: info.ip });
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
              platform: "samsung-tizen",
              config: wrapPlatformCredentials("samsung-tizen", credentials),
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
      [isSetupState, isPairingState, isCompleteState, isErrorState, actorRef, onComplete],
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
          <TizenPairingStep actorRef={actorRef} />
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
