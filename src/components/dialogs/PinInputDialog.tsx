import { useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useDialogKeyboard, type PromptContext } from "@opentui-ui/dialog/react";

export function PinInputDialog({ resolve, dismiss, dialogId }: PromptContext<string>) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  useDialogKeyboard((event) => {
    if (event.name === "escape") {
      dismiss();
    } else if (event.name === "return" && pin.length === 4) {
      resolve(pin);
    } else if (event.name === "backspace") {
      setPin((p) => p.slice(0, -1));
      setError(null);
    } else if (/^[0-9]$/.test(event.sequence) && pin.length < 4) {
      setPin((p) => p + event.sequence);
      setError(null);
    }
  }, dialogId);

  return (
    <box flexDirection="column" gap={1}>
      <text fg="#00AAFF" attributes={TextAttributes.BOLD}>Philips TV Pairing</text>
      <text fg="#666666">Enter the 4-digit PIN shown on your TV</text>
      <box marginTop={1}>
        <text>PIN: </text>
        <text fg="#FFAA00" attributes={TextAttributes.BOLD}>{pin.padEnd(4, "_")}</text>
      </box>
      {error && <text fg="#FF4444">{error}</text>}
      <text fg="#666666">Press Enter to submit, Esc to cancel</text>
    </box>
  );
}
