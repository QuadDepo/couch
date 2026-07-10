import { TextAttributes } from "@opentui/core";
import { DIM_COLOR, FOCUS_COLOR, TEXT_PRIMARY, TEXT_SECONDARY } from "../../constants/colors.ts";

interface TextInputProps {
  value: string;
  focused?: boolean;
  label?: string;
  placeholder?: string;
  mask?: boolean;
  showBorder?: boolean;
  labelWidth?: number;
}

export function TextInput({
  value,
  focused = false,
  label,
  placeholder,
  mask = false,
  showBorder = false,
  labelWidth = 6,
}: TextInputProps) {
  const displayValue = mask ? value.replace(/./g, "*") : value;
  const showPlaceholder = !value && placeholder && !focused;

  const textColor = focused ? FOCUS_COLOR : TEXT_PRIMARY;

  const content = (
    <box flexDirection="row">
      {label && (
        <text fg={TEXT_SECONDARY} width={labelWidth}>
          {label}
        </text>
      )}
      <text fg={textColor} attributes={focused ? TextAttributes.UNDERLINE : 0}>
        {showPlaceholder ? placeholder : displayValue || (focused ? "_" : "")}
      </text>
      {focused && value && (
        <text fg={FOCUS_COLOR} attributes={TextAttributes.BOLD}>
          _
        </text>
      )}
    </box>
  );

  if (showBorder) {
    return (
      <box
        borderStyle="single"
        borderColor={focused ? FOCUS_COLOR : DIM_COLOR}
        paddingLeft={1}
        paddingRight={1}
      >
        {content}
      </box>
    );
  }

  return content;
}
