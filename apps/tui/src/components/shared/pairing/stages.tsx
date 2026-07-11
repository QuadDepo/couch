import { CompletionStep } from "../../dialogs/wizard/CompletionStep.tsx";
import { WizardShell } from "../../dialogs/wizard/WizardShell.tsx";
import { DeviceInfoFields, type DeviceInfoFieldsState } from "../DeviceInfoFields.tsx";

interface PairingSetupStageProps {
  progress: string;
  deviceInfo: DeviceInfoFieldsState;
  error?: string;
}

export function PairingSetupStage({ progress, deviceInfo, error }: PairingSetupStageProps) {
  return (
    <WizardShell stepLabel="Device Info" progress={progress}>
      <DeviceInfoFields
        name={deviceInfo.name}
        ip={deviceInfo.ip}
        activeField={deviceInfo.activeField}
        error={error}
      />
    </WizardShell>
  );
}

interface PairingCompleteStageProps {
  progress: string;
  deviceName?: string;
  fallbackName?: string;
}

export function PairingCompleteStage({
  progress,
  deviceName,
  fallbackName,
}: PairingCompleteStageProps) {
  return (
    <WizardShell stepLabel="Complete" progress={progress}>
      <CompletionStep deviceName={deviceName || fallbackName || "Device"} />
    </WizardShell>
  );
}
