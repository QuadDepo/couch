import { TextAttributes } from "@opentui/core";
import { useWizard } from "./WizardProvider.tsx";

export function WizardHeader() {
  const { stepLabel, progressString } = useWizard();

  return (
    <>
      <box flexDirection="row" justifyContent="space-between">
        <text fg="#00AAFF" attributes={TextAttributes.BOLD}>
          Add Device
        </text>
        <text fg="#666666">{progressString}</text>
      </box>
      <text fg="#888888">{stepLabel}</text>
    </>
  );
}
