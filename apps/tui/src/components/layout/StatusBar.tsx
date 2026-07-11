import type { ConnectionStatus, TVDevice } from "@couch/device";
import { DIM_COLOR, TEXT_DIM, TEXT_PRIMARY, WARNING_COLOR } from "../../constants/colors.ts";
import { useDevice } from "../../hooks/useDevice.ts";
import { getStatusIndicator } from "../../utils/statusIndicator.ts";
import { KeyHint } from "../shared/KeyHint.tsx";

interface StatusView {
  icon: string;
  color: string;
  text: string;
}

function describeConnection(device: TVDevice, status: ConnectionStatus): string {
  switch (status) {
    case "connected":
      return `Connected to ${device.name}`;
    case "connecting":
      return `Connecting to ${device.name}...`;
    case "pairing":
      return `Pairing with ${device.name}...`;
    case "error":
      return `Error connecting to ${device.name}`;
    default:
      return `Disconnected from ${device.name}`;
  }
}

function getStatusView(device: TVDevice | null, status: ConnectionStatus): StatusView {
  if (!device) {
    return { icon: "-", color: TEXT_DIM, text: "No device selected" };
  }

  const { icon, color } = getStatusIndicator(status);
  return { icon, color, text: describeConnection(device, status) };
}

export function StatusBar() {
  const { device, status, isImplemented } = useDevice();

  const statusView = getStatusView(device, status);

  return (
    <box
      width="100%"
      height={3}
      borderStyle="single"
      borderColor={DIM_COLOR}
      flexDirection="row"
      alignItems="center"
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={statusView.color}> {statusView.icon} </text>
      <text fg={TEXT_PRIMARY}>{statusView.text}</text>
      {status === "connected" && <text fg={TEXT_DIM}> ({device?.ip})</text>}
      {device && !isImplemented && <text fg={WARNING_COLOR}> [Platform not implemented]</text>}
      <box flexGrow={1} />
      {device && isImplemented && (
        <KeyHint keyName="C" label={status === "connected" ? "Disconnect" : "Connect"} />
      )}
    </box>
  );
}
