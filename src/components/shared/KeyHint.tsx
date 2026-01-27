import { TextAttributes } from "@opentui/core";
import { ACTIVE_COLOR, HIGHLIGHT_COLOR, TEXT_DIM, TEXT_MUTED } from "../../constants/colors.ts";

export type HintVariant = "bracket" | "plain";

interface KeyHintProps {
  keyName: string;
  label: string;
  highlight?: boolean;
  variant?: HintVariant;
}

export function KeyHint({ keyName, label, highlight, variant = "bracket" }: KeyHintProps) {
  return (
    <box flexDirection="row">
      {variant === "bracket" ? (
        <>
          <text fg={highlight ? ACTIVE_COLOR : TEXT_DIM}>[</text>
          <text fg={highlight ? ACTIVE_COLOR : HIGHLIGHT_COLOR} attributes={TextAttributes.BOLD}>
            {keyName}
          </text>
          <text fg={highlight ? ACTIVE_COLOR : TEXT_DIM}>]</text>
          <text fg={TEXT_MUTED}> {label}</text>
        </>
      ) : (
        <>
          <text fg={TEXT_MUTED} attributes={TextAttributes.BOLD}>
            {keyName}
          </text>
          <text fg={TEXT_DIM}> {label}</text>
        </>
      )}
    </box>
  );
}
