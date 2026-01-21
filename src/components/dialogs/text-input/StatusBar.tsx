import { useMemo } from "react";
import { TextAttributes } from "@opentui/core";
import { DIM_COLOR, ACTIVE_COLOR, ERROR_COLOR } from "./constants.ts";
import type { TVPlatform } from "../../../types/index.ts";

interface StatusBarProps {
  enabled: boolean;
  status: { type: "idle" | "sending" | "success" | "error"; message: string };
  deviceType: TVPlatform | null;
}

const STATUS_COLORS = {
  idle: DIM_COLOR,
  sending: "#FFFF00",
  success: ACTIVE_COLOR,
  error: ERROR_COLOR,
} as const;

export function StatusBar({ enabled, status, deviceType }: StatusBarProps) {
  const fg = STATUS_COLORS[status.type];
  const methodLabel = deviceType === "android-tv" ? "Fast (ADB)" : "N/A";

  const content = useMemo(() => {
    if (!enabled) return null;
    if (status.type === "idle") {
      return (
        <box justifyContent="flex-end">
          <text fg={DIM_COLOR}>{methodLabel}</text>
        </box>
      );
    }
    return (
      <box justifyContent="center">
        <text fg={fg} attributes={TextAttributes.BOLD}>
          {status.message}
        </text>
      </box>
    );
  }, [enabled, status.type, status.message, fg, methodLabel]);

  return content;
}
