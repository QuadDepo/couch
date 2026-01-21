import { useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { useDialog, useDialogState } from "@opentui-ui/dialog/react";
import type { TVDevice } from "../../types/index.ts";
import { useDeviceStore } from "../../store/deviceStore.ts";
import { useDeviceHandler } from "../../hooks/useDeviceHandler.ts";
import { AddDeviceWizard, type AddDeviceResult } from "../dialogs/AddDeviceWizard.tsx";
import { RemoveDeviceDialog } from "../dialogs/RemoveDeviceDialog.tsx";
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
  const removeDevice = useDeviceStore((s) => s.removeDevice);

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

  const handleRemoveDevice = useCallback(async () => {
    if (!activeDevice) return;

    const confirmed = await dialog.prompt<boolean>({
      content: (ctx) => <RemoveDeviceDialog device={activeDevice} {...ctx} />,
      size: "small",
    });

    if (confirmed) {
      removeDevice(activeDevice.id);

      // Select another device after removal
      const remainingDevices = devices.filter((d) => d.id !== activeDevice.id);
      if (remainingDevices.length > 0) {
        // Try to select the device at the same index, or the previous one
        const nextIndex = Math.min(safeSelectedIndex, remainingDevices.length - 1);
        selectDevice(remainingDevices[nextIndex]?.id ?? null);
      } else {
        selectDevice(null);
      }
    }
  }, [dialog, activeDevice, devices, safeSelectedIndex, removeDevice, selectDevice]);

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
      case "x":
        handleRemoveDevice();
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
        <text fg="#666666">[X] to remove</text>
      </box>
    </Panel>
  );
}
