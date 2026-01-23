import { TextAttributes } from "@opentui/core";

interface CompletionMessageProps {
  deviceName: string;
}

export function CompletionMessage({ deviceName }: CompletionMessageProps) {
  return (
    <box flexDirection="column" gap={1}>
      <text fg="#00FF00" attributes={TextAttributes.BOLD}>
        Device Added Successfully!
      </text>
      <text fg="#FFFFFF">"{deviceName}" has been added and configured.</text>
      <box marginTop={1} flexDirection="row">
        <text fg="#888888" attributes={TextAttributes.BOLD}>
          Enter
        </text>
        <text fg="#666666"> or </text>
        <text fg="#888888" attributes={TextAttributes.BOLD}>
          Esc
        </text>
        <text fg="#666666"> to close</text>
      </box>
    </box>
  );
}
