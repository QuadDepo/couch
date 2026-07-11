import type { TextQuickAction } from "@couch/device";
import { TextAttributes } from "@opentui/core";
import { ACTIVE_COLOR, DIM_COLOR, FOCUS_COLOR, TEXT_SECONDARY } from "../../constants/colors.ts";

// `action` matches the device capability list (`textQuickActions`); `keyName`
// is the terminal key event name that triggers it (Enter arrives as "return").
export const QUICK_ACTIONS = [
  { action: "enter", keyName: "return", label: "[Enter]", char: "\n" },
  { action: "space", keyName: "space", label: "[Space]", char: " " },
  { action: "backspace", keyName: "backspace", label: "[Bs]", char: "\b" },
] as const satisfies readonly {
  action: TextQuickAction;
  keyName: string;
  label: string;
  char: string;
}[];

export type QuickActionRow = (typeof QUICK_ACTIONS)[number];

interface QuickActionsProps {
  focused: boolean;
  lastAction: string | null;
  actions: readonly string[];
}

export function QuickActions({ focused, lastAction, actions }: QuickActionsProps) {
  return (
    <>
      <box>
        <text fg={focused ? FOCUS_COLOR : DIM_COLOR}>
          {focused ? "▶ QUICK ACTIONS" : "▷ QUICK ACTIONS"}
        </text>
      </box>
      <box flexDirection="row" gap={2}>
        {QUICK_ACTIONS.filter(({ action }) => actions.includes(action)).map(({ action, label }) => (
          <text
            key={action}
            fg={lastAction === action ? ACTIVE_COLOR : focused ? TEXT_SECONDARY : DIM_COLOR}
            attributes={lastAction === action ? TextAttributes.BOLD : undefined}
          >
            {label}
          </text>
        ))}
      </box>
    </>
  );
}
