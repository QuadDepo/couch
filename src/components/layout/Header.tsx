import { TextAttributes } from "@opentui/core";
import { DIM_COLOR, FOCUS_COLOR, TEXT_DIM } from "../../constants/colors.ts";
import { KeyHint } from "../shared/KeyHint.tsx";

type FocusPath =
  | "app/dpad"
  | "app/devices"
  | "modal/text-input"
  | "modal/wizard"
  | "modal/add-device";

interface HeaderProps {
  focusPath: FocusPath;
}

const getSectionLabel = (path: FocusPath): string => {
  if (path.startsWith("app/")) {
    const section = path.split("/")[1];
    return section === "devices" ? "DEVICES" : "D-PAD";
  }
  return "MODAL";
};

export function Header({ focusPath }: HeaderProps) {
  const showFocus = focusPath.startsWith("app/");
  const sectionLabel = getSectionLabel(focusPath);

  return (
    <box
      width="100%"
      height={3}
      borderStyle="single"
      borderColor={DIM_COLOR}
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      paddingLeft={1}
      paddingRight={1}
    >
      <box flexDirection="row">
        <text fg={FOCUS_COLOR} attributes={TextAttributes.BOLD}>
          COUCH
        </text>
        <text fg={TEXT_DIM}> - Smart TV Remote</text>
      </box>
      <box flexDirection="row">
        <KeyHint keyName="Tab" label="Switch" />
        {showFocus && (
          <>
            <text fg={TEXT_DIM}> | Focus: </text>
            <text fg={FOCUS_COLOR} attributes={TextAttributes.BOLD}>
              {sectionLabel}
            </text>
          </>
        )}
      </box>
    </box>
  );
}
