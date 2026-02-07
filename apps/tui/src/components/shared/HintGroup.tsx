import { TEXT_DIM } from "@couch/devices";
import { type HintVariant, KeyHint } from "./KeyHint.tsx";

interface HintItem {
  key: string;
  label: string;
  highlight?: boolean;
}

interface HintGroupProps {
  hints: HintItem[];
  variant?: HintVariant;
}

export function HintGroup({ hints, variant = "bracket" }: HintGroupProps) {
  return (
    <box flexDirection="row">
      {hints.map((hint, index) => (
        <box key={hint.key} flexDirection="row">
          {index > 0 && <text fg={TEXT_DIM}> </text>}
          <KeyHint
            keyName={hint.key}
            label={hint.label}
            highlight={hint.highlight}
            variant={variant}
          />
        </box>
      ))}
    </box>
  );
}
