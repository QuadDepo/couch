import { selectConnectionStatus, type TVDevice } from "@couch/device";
import { useSelector } from "@xstate/react";
import { FOCUS_COLOR, TEXT_DIM, TEXT_PRIMARY } from "../../constants/colors.ts";
import { useDeviceStore } from "../../store/deviceStore";
import { lookupPlatformRegistration } from "../../utils/platformRegistry.ts";
import { getStatusIndicator } from "../../utils/statusIndicator.ts";

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
        [{lookupPlatformRegistration(device.platform)?.label ?? device.platform}]
      </text>
    </box>
  );
}
