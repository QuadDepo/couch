import { TextAttributes } from "@opentui/core";
import { DIM_COLOR, FOCUS_COLOR } from "./constants.ts";

interface QuickActionsProps {
  focused: boolean;
  lastAction: string | null;
}


interface QuickAction {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly sendValue: string;
}

const QUICK_ACTIONS: readonly QuickAction[] = [
  { id: "enter", key: "Enter", label: "Send Enter", sendValue: "\n" },
  { id: "space", key: "Space", label: "Send Space", sendValue: " " },
  { id: "del", key: "Bs", label: "Send Delete", sendValue: "\b" },
]

export function QuickActions({ focused, lastAction }: QuickActionsProps) {
  return (
    <>
      <box justifyContent="center">
        <text fg={focused ? FOCUS_COLOR : DIM_COLOR}>
          {focused ? "▶ QUICK ACTIONS" : "  Quick Actions (Tab to focus)"}
        </text>
      </box>

      <box flexDirection="row" gap={2} justifyContent="center">
        {QUICK_ACTIONS.map((action) => {
          const isActive = lastAction === action.id;
          const fg = isActive ? "#00FF00" : focused ? "#AAAAAA" : DIM_COLOR;
          return (
            <text key={action.id} fg={fg} attributes={isActive ? TextAttributes.BOLD : undefined}>
              [{action.key}]
            </text>
          );
        })}
      </box>
    </>
  );
}
