import type { BoxProps } from "@opentui/react";
import type { ReactNode } from "react";

interface PanelProps extends Omit<BoxProps, "borderStyle" | "borderColor" | "flexDirection"> {
  title?: string;
  focused?: boolean;
  children: ReactNode;
}

export function Panel({
  title,
  focused = false,
  children,
  alignItems,
  justifyContent,
  ...boxProps
}: PanelProps) {
  const borderColor = focused ? "#00AAFF" : "#444444";
  const titleColor = focused ? "#00AAFF" : "#888888";

  return (
    <box flexDirection="column" borderStyle="single" borderColor={borderColor} {...boxProps}>
      {title && (
        <box paddingLeft={1} paddingRight={1}>
          <text fg={titleColor}>{title}</text>
        </box>
      )}
      <box
        flexDirection="column"
        padding={1}
        flexGrow={1}
        alignItems={alignItems}
        justifyContent={justifyContent}
      >
        {children}
      </box>
    </box>
  );
}
