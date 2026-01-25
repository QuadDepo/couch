import { TextAttributes } from "@opentui/core";

interface HintItem {
  key: string;
  label: string;
}

interface WizardHintsProps {
  hints: HintItem[];
}

export function WizardHints({ hints }: WizardHintsProps) {
  return (
    <box marginTop={1} flexDirection="row">
      {hints.map((hint, index) => (
        <box key={hint.key} flexDirection="row">
          {index > 0 && <text fg="#666666"> </text>}
          <text fg="#888888" attributes={TextAttributes.BOLD}>
            {hint.key}
          </text>
          <text fg="#666666"> {hint.label}</text>
        </box>
      ))}
    </box>
  );
}
