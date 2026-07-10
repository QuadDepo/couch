import type { ConnectionStatus } from "@couch/device";
import {
  ACTIVE_COLOR,
  ERROR_COLOR,
  FOCUS_COLOR,
  TEXT_DIM,
  WARNING_COLOR,
} from "../constants/colors.ts";

export type StatusIndicator = {
  icon: string;
  color: string;
};

export function getStatusIndicator(status: ConnectionStatus): StatusIndicator {
  switch (status) {
    case "connected":
      return { icon: "●", color: ACTIVE_COLOR };
    case "connecting":
      return { icon: "○", color: WARNING_COLOR };
    case "pairing":
      return { icon: "◐", color: FOCUS_COLOR };
    case "error":
      return { icon: "●", color: ERROR_COLOR };
    default:
      return { icon: "○", color: TEXT_DIM };
  }
}
