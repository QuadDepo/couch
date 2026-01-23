import { TextAttributes } from "@opentui/core";
import type { PairingUIState } from "../../../devices/types.ts";

interface PairingStepRendererProps {
  uiState: PairingUIState;
}

export function PairingStepRenderer({ uiState }: PairingStepRendererProps) {
  const { title, description, variant, input, canRetry } = uiState;

  return (
    <box flexDirection="column" gap={1}>
      <text fg="#FFFFFF" attributes={TextAttributes.BOLD}>
        {title}
      </text>

      <text fg={variant === "error" ? "#FF4444" : "#AAAAAA"}>{description}</text>

      {variant === "loading" && (
        <text fg="#FFAA00" marginTop={1}>
          Please wait...
        </text>
      )}

      {variant === "input" && input && (
        <box flexDirection="row" marginTop={1}>
          <text fg="#AAAAAA">Enter: </text>
          <text fg="#FFAA00" attributes={TextAttributes.BOLD}>
            {input.type === "pin"
              ? formatPinInput(input.value, input.maxLength)
              : input.value || "_"}
          </text>
          {input.value && (
            <text fg="#FFAA00" attributes={TextAttributes.BOLD}>
              _
            </text>
          )}
        </box>
      )}

      <box marginTop={1} flexDirection="row">
        <text fg="#888888" attributes={TextAttributes.BOLD}>
          Esc
        </text>
        <text fg="#666666"> to close</text>
        {variant !== "loading" && (
          <>
            <text fg="#666666">, </text>
            <text fg="#888888" attributes={TextAttributes.BOLD}>
              Ctrl+Bksp
            </text>
            <text fg="#666666"> to go back</text>
            {canRetry && (
              <>
                <text fg="#666666">, </text>
                <text fg="#888888" attributes={TextAttributes.BOLD}>
                  Enter
                </text>
                <text fg="#666666"> to retry</text>
              </>
            )}
            {variant === "input" && (
              <>
                <text fg="#666666">, </text>
                <text fg="#888888" attributes={TextAttributes.BOLD}>
                  Enter
                </text>
                <text fg="#666666"> to submit</text>
              </>
            )}
            {variant === "action" && (
              <>
                <text fg="#666666">, </text>
                <text fg="#888888" attributes={TextAttributes.BOLD}>
                  Enter
                </text>
                <text fg="#666666"> to continue</text>
              </>
            )}
            {variant === "info" && (
              <>
                <text fg="#666666">, </text>
                <text fg="#888888" attributes={TextAttributes.BOLD}>
                  Enter
                </text>
                <text fg="#666666"> to continue</text>
              </>
            )}
          </>
        )}
      </box>
    </box>
  );
}

function formatPinInput(value: string, maxLength?: number): string {
  if (!value) return "_".repeat(maxLength || 4);
  const remaining = (maxLength || 4) - value.length;
  return value + "_".repeat(Math.max(0, remaining));
}
