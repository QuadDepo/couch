import { TextAttributes } from "@opentui/core";

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
      borderColor="#444444"
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      paddingLeft={1}
      paddingRight={1}
    >
      <box flexDirection="row">
        <text fg="#00AAFF" attributes={TextAttributes.BOLD}>
          COUCH
        </text>
        <text fg="#666666"> - Smart TV Remote</text>
      </box>
      <box flexDirection="row">
        <text fg="#666666">[Tab] Switch</text>
        {showFocus && (
          <>
            <text fg="#666666"> | Focus: </text>
            <text fg="#00AAFF" attributes={TextAttributes.BOLD}>
              {sectionLabel}
            </text>
          </>
        )}
      </box>
    </box>
  );
}
