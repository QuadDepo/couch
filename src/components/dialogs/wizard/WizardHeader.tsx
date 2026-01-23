import { TextAttributes } from "@opentui/core";

interface WizardHeaderProps {
  platform: string;
  isComplete: boolean;
  /** Subtitle shown when not complete. Defaults to "Pairing" */
  subtitle?: string;
}

export function WizardHeader({ platform, isComplete, subtitle = "Pairing" }: WizardHeaderProps) {
  return (
    <>
      <box flexDirection="row" justifyContent="space-between">
        <text fg="#00AAFF" attributes={TextAttributes.BOLD}>
          Add Device
        </text>
        <text fg="#666666">{platform}</text>
      </box>
      <text fg="#888888">{isComplete ? "Complete" : subtitle}</text>
    </>
  );
}
