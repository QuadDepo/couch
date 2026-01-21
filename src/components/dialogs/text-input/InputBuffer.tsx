import { TextAttributes } from "@opentui/core";
import { DIM_COLOR, FOCUS_COLOR } from "./constants.ts";

interface InputBufferProps {
  input: string;
  focused: boolean;
  enabled: boolean;
}

export function InputBuffer({ input, focused, enabled }: InputBufferProps) {
  const bright = enabled ? "#FFFFFF" : DIM_COLOR;

  return (
    <box
      borderStyle="single"
      borderColor={focused ? FOCUS_COLOR : DIM_COLOR}
      paddingLeft={1}
      paddingRight={1}
      justifyContent="center"
    >
      <box flexDirection="row" gap={1}>
        <text fg={focused ? FOCUS_COLOR : DIM_COLOR}>
          {focused ? "▶" : "▷"}
        </text>
        <text
          fg={focused ? FOCUS_COLOR : bright}
          attributes={focused ? TextAttributes.BOLD : undefined}
        >
          {input}
        </text>
        {focused && <text fg={FOCUS_COLOR} attributes={TextAttributes.BOLD}>_</text>}
      </box>
    </box>
  );
}
