import { TEXT_PRIMARY } from "@couch/devices";
import { TextAttributes } from "@opentui/core";
import type { ReactNode } from "react";
import { HintGroup } from "../HintGroup.tsx";

interface Hint {
  key: string;
  label: string;
}

interface PairingStepLayoutProps {
  title: string;
  hints: Hint[];
  children: ReactNode;
}

export function PairingStepLayout({ title, hints, children }: PairingStepLayoutProps) {
  return (
    <box flexDirection="column" gap={1}>
      <text fg={TEXT_PRIMARY} attributes={TextAttributes.BOLD}>
        {title}
      </text>
      {children}
      {hints.length > 0 && (
        <box marginTop={1}>
          <HintGroup hints={hints} variant="plain" />
        </box>
      )}
    </box>
  );
}
