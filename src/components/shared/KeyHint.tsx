import { TextAttributes } from "@opentui/core";

interface KeyHintProps {
  keyLabel: string;
  description: string;
  highlight?: boolean;
}

export function KeyHint({ keyLabel, description, highlight = false }: KeyHintProps) {
  return (
    <box>
      <text fg={highlight ? "#00FF00" : "#666666"}>[</text>
      <text fg={highlight ? "#00FF00" : "#FFFF00"} attributes={TextAttributes.BOLD}>
        {keyLabel}
      </text>
      <text fg={highlight ? "#00FF00" : "#666666"}>]</text>
      <text fg="#888888"> {description}</text>
    </box>
  );
}
