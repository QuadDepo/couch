import { TextAttributes } from "@opentui/core";
import type { ReactNode } from "react";
import { DIM_COLOR } from "../../../constants/colors.ts";

interface Props {
  stepLabel: string;
  progress: string;
  children: ReactNode;
}

export function WizardShell({ stepLabel, progress, children }: Props) {
  return (
    <box
      flexDirection="column"
      gap={1}
      paddingLeft={4}
      paddingRight={4}
      paddingTop={2}
      paddingBottom={2}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD}>{stepLabel}</text>
        {progress && <text fg={DIM_COLOR}>{progress}</text>}
      </box>
      <box marginTop={1}>{children}</box>
    </box>
  );
}
