import {
  FOCUS_COLOR,
  getStatusIndicator,
  type ImplementedPlatform,
  platformRegistry,
  selectConnectionStatus,
  TEXT_DIM,
  TEXT_PRIMARY,
  type TVDevice,
} from "@couch/devices";
import { useSelector } from "@xstate/react";
import { useDeviceStore } from "../../store/deviceStore";

interface DeviceListItemProps {
  device: TVDevice;
  isSelected: boolean;
  isFocused: boolean;
}

export function DeviceListItem({ device, isSelected, isFocused }: DeviceListItemProps) {
  const actor = useDeviceStore((s) => s.deviceActors.get(device.id)?.actor);
  const status = useSelector(actor, selectConnectionStatus);

  const prefix = isSelected && isFocused ? ">" : " ";
  const statusIndicator = getStatusIndicator(status);
  const textColor = isSelected && isFocused ? FOCUS_COLOR : TEXT_PRIMARY;

  return (
    <box flexDirection="row">
      <text fg={textColor}>{prefix}</text>
      <text fg={statusIndicator.color}>{statusIndicator.icon}</text>
      <text fg={textColor}> {device.name}</text>
      <text fg={TEXT_DIM}>
        {" "}
        [{platformRegistry[device.platform as ImplementedPlatform]?.label ?? device.platform}]
      </text>
    </box>
  );
}
