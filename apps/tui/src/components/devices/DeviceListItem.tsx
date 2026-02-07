import {
  FOCUS_COLOR,
  getStatusIndicator,
  selectConnectionStatus,
  TEXT_DIM,
  TEXT_PRIMARY,
  type TVDevice,
} from "@couch/devices";
import { useSelector } from "@xstate/react";
import { useDeviceStore } from "../../store/deviceStore";

const platformLabels: Record<TVDevice["platform"], string> = {
  "android-tv": "Android",
  "philips-android-tv": "Philips",
  "lg-webos": "LG",
  "samsung-tizen": "Samsung",
  "titan-os": "Titan",
  "apple-tv": "Apple",
};

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
      <text fg={TEXT_DIM}> [{platformLabels[device.platform]}]</text>
    </box>
  );
}
