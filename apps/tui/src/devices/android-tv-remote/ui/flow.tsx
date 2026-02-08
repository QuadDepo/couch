import {
  androidTvRemoteDeviceMachine,
  inspector,
  type TVDevice,
  wrapPlatformCredentials,
} from "@couch/devices";
import {
  isComplete,
  isPairing,
  isPairingError,
  isPairingWaitingForUser,
  isSetup,
  selectDeviceName,
  selectError,
  selectPairingCode,
} from "@couch/devices/android-tv-remote/selectors";
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
import { AndroidTvRemotePairingStep } from "./steps.tsx";

const HEX_CHARS = /^[0-9a-fA-F]$/;

export const AndroidTvRemotePairingFlow = forwardRef<PairingFlowHandle, PairingFlowProps>(
  function AndroidTvRemotePairingFlow({ onComplete }, ref) {
    const actorRef = useActorRef(androidTvRemoteDeviceMachine, {
      input: { platform: "android-tv-remote" as const },
      inspect: inspector?.inspect,
    });

    const deviceInfoRef = useRef<DeviceInfoFieldsRef>(null);

    const isSetupState = useSelector(actorRef, isSetup);
    const isPairingState = useSelector(actorRef, isPairing);
    const isCompleteState = useSelector(actorRef, isComplete);
    const isErrorState = useSelector(actorRef, isPairingError);
    const isWaitingForCode = useSelector(actorRef, isPairingWaitingForUser);

    const deviceName = useSelector(actorRef, selectDeviceName);
    const error = useSelector(actorRef, selectError);
    const pairingCode = useSelector(actorRef, selectPairingCode);

    useImperativeHandle(
      ref,
      () => ({
        canGoBack: () => isSetupState || isPairingState,

        canContinue: () => {
          if (isSetupState) return deviceInfoRef.current?.isValid ?? false;
          if (isWaitingForCode && pairingCode.length === 6) return true;
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
          if (isWaitingForCode && pairingCode.length === 6) {
            actorRef.send({ type: "SUBMIT_CODE", code: pairingCode });
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
              platform: "android-tv-remote",
              config: wrapPlatformCredentials("android-tv-remote", credentials),
            };
            onComplete({ device, actor: actorRef });
          }
        },

        handleChar: (char) => {
          if (isSetupState) {
            deviceInfoRef.current?.handleChar(char);
            return;
          }
          if (isWaitingForCode && HEX_CHARS.test(char) && pairingCode.length < 6) {
            actorRef.send({
              type: "SET_PAIRING_CODE",
              code: pairingCode + char.toUpperCase(),
            });
          }
        },

        handleBackspace: () => {
          if (isSetupState) {
            deviceInfoRef.current?.handleBackspace();
            return;
          }
          if (isWaitingForCode && pairingCode.length > 0) {
            actorRef.send({
              type: "SET_PAIRING_CODE",
              code: pairingCode.slice(0, -1),
            });
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
        isWaitingForCode,
        pairingCode,
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
          <AndroidTvRemotePairingStep actorRef={actorRef} />
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
