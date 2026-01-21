import { useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { useDialog, useDialogState } from "@opentui-ui/dialog/react";
import type { TVDevice } from "../../types/index.ts";
import { useDeviceStore } from "../../store/deviceStore.ts";
import { useDeviceHandler } from "../../hooks/useDeviceHandler.ts";
import { AddDeviceWizard, type AddDeviceResult } from "../dialogs/AddDeviceWizard.tsx";
import { Panel } from "../shared/Panel.tsx";

interface DeviceListProps {
  focused?: boolean;
}

const platformLabels: Record<TVDevice["platform"], string> = {
  "android-tv": "Android",
  "philips-android-tv": "Philips",
  "lg-webos": "LG",
  "samsung-tizen": "Samsung",
  "titan-os": "Titan",
  "apple-tv": "Apple",
};

export function DeviceList({ focused = false }: DeviceListProps) {
  const dialog = useDialog();
  const isDialogOpen = useDialogState((s) => s.isOpen);

  const devices = useDeviceStore((s) => s.devices);
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const selectDevice = useDeviceStore((s) => s.selectDevice);
  const addDevice = useDeviceStore((s) => s.addDevice);

  const activeDevice = devices.find((d) => d.id === selectedDeviceId) ?? null;
  const selectedIndex = devices.findIndex((d) => d.id === selectedDeviceId);
  const safeSelectedIndex = selectedIndex === -1 ? 0 : selectedIndex;

  const { connect, disconnect } = useDeviceHandler(activeDevice);

  const handleAddDevice = useCallback(async () => {
    const result = await dialog.prompt<AddDeviceResult | null>({
      content: (ctx) => <AddDeviceWizard {...ctx} />,
      size: "large",
    });

    if (result?.device) {
      addDevice(result.device);
      selectDevice(result.device.id);
    }
  }, [dialog, addDevice, selectDevice]);

  const handleConnect = useCallback(() => {
    if (!activeDevice) return;
    if (activeDevice.status === "disconnected" || activeDevice.status === "error") {
      connect();
    } else if (activeDevice.status === "connected") {
      disconnect();
    }
  }, [activeDevice, connect, disconnect]);

  useKeyboard((event) => {
    if (!focused || isDialogOpen) return;

    switch (event.name) {
      case "up":
        if (safeSelectedIndex > 0) {
          const device = devices[safeSelectedIndex - 1];
          if (device) selectDevice(device.id);
        }
        break;
      case "down":
        if (safeSelectedIndex < devices.length - 1) {
          const device = devices[safeSelectedIndex + 1];
          if (device) selectDevice(device.id);
        }
        break;
      case "return":
        const device = devices[safeSelectedIndex];
        if (device) selectDevice(device.id);
        break;
      case "a":
        handleAddDevice();
        break;
      case "c":
        handleConnect();
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
        const isSelected = index === safeSelectedIndex;
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
