import { useKeyboard } from "@opentui/react";
import { useDialogState } from "@opentui-ui/dialog/react";
import type { TVDevice } from "../../types/index.ts";
import { Panel } from "../shared/Panel.tsx";

interface DeviceListProps {
  devices: TVDevice[];
  activeDevice: TVDevice | null;
  selectedIndex: number;
  focused?: boolean;
  onSelectedIndexChange: (index: number) => void;
  onSelect: (device: TVDevice) => void;
}

const platformLabels: Record<TVDevice["platform"], string> = {
  "android-tv": "Android",
  "philips-android-tv": "Philips",
  "lg-webos": "LG",
  "samsung-tizen": "Samsung",
  "titan-os": "Titan",
  "apple-tv": "Apple",
};

export function DeviceList({
  devices,
  activeDevice,
  selectedIndex,
  focused = false,
  onSelectedIndexChange,
  onSelect,
}: DeviceListProps) {
  const isDialogOpen = useDialogState((s) => s.isOpen);

  useKeyboard((event) => {
    if (!focused || isDialogOpen) return;

    switch (event.name) {
      case "up":
        if (selectedIndex > 0) {
          onSelectedIndexChange(selectedIndex - 1);
        }
        break;
      case "down":
        if (selectedIndex < devices.length - 1) {
          onSelectedIndexChange(selectedIndex + 1);
        }
        break;
      case "return":
        const device = devices[selectedIndex];
        if (device) {
          onSelect(device);
        }
        break;
    }
  });

  if (devices.length === 0) {
    return (
      <Panel title="DEVICES" width={32} focused={focused}>
        <text fg="#666666">No devices found</text>
      </Panel>
    );
  }

  return (
    <Panel title="DEVICES" width={32} focused={focused}>
      {devices.map((device, index) => {
        const isActive = device.id === activeDevice?.id;
        const isSelected = index === selectedIndex;
        const statusIcon = isActive ? "*" : " ";
        const prefix = isSelected && focused ? ">" : " ";

        return (
          <box key={device.id} flexDirection="row">
            <text fg={isSelected && focused ? "#00AAFF" : "#FFFFFF"}>
              {prefix}
              {statusIcon} {device.name}
            </text>
            <text fg="#666666"> [{platformLabels[device.platform]}]</text>
          </box>
        );
      })}
      <box marginTop="auto">
        <text fg="#666666">Use ↑/↓ to navigate</text>
        <text fg="#666666">[A] to add</text>
      </box>
    </Panel>
  );
}
