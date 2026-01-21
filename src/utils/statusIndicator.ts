import type { ConnectionStatus } from "../types/index.ts";

export type StatusIndicator = {
  icon: string;
  color: string;
};

export function getStatusIndicator(status: ConnectionStatus): StatusIndicator {
  switch (status) {
    case "connected":
      return { icon: "●", color: "#00FF00" };
    case "connecting":
      return { icon: "○", color: "#FFAA00" };
    case "pairing":
      return { icon: "◐", color: "#00AAFF" };
    case "error":
      return { icon: "●", color: "#FF0000" };
    default:
      return { icon: "○", color: "#666666" };
  }
}
