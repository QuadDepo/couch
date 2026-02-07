import { TEXT_DIM, TEXT_MUTED } from "@couch/devices";
import { useKeyboard } from "@opentui/react";
import { useDialog, useDialogState } from "@opentui-ui/dialog/react";
import { useCallback } from "react";
import { useDevice } from "../../hooks/useDevice";
import { useDeviceStore } from "../../store/deviceStore";
import { type AddDeviceResult, AddDeviceWizard } from "../dialogs/AddDeviceWizard";
import { RemoveDeviceDialog } from "../dialogs/RemoveDeviceDialog";
import { HintGroup } from "../shared/HintGroup.tsx";
import { Panel } from "../shared/Panel";
import { DeviceListItem } from "./DeviceListItem";

interface DeviceListProps {
  focused?: boolean;
}

export function DeviceList({ focused = false }: DeviceListProps) {
  const dialog = useDialog();
  const isDialogOpen = useDialogState((s) => s.isOpen);

  const devices = useDeviceStore((s) => s.devices);
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const selectDevice = useDeviceStore((s) => s.selectDevice);
  const addDevice = useDeviceStore((s) => s.addDevice);
  const removeDevice = useDeviceStore((s) => s.removeDevice);

  const selectedIndex = devices.findIndex((d) => d.id === selectedDeviceId);
  const safeSelectedIndex = selectedIndex === -1 ? 0 : selectedIndex;

  const { device: activeDevice, status, connect, disconnect } = useDevice();

  const handleAddDevice = useCallback(async () => {
    const result = await dialog.prompt<AddDeviceResult | null>({
      content: (ctx) => <AddDeviceWizard {...ctx} />,
      size: "large",
    });

    if (result?.device) {
      // Don't pass wizard actor - it gets stopped on dialog unmount
      // Store creates a fresh actor with device credentials
      addDevice(result.device);
      selectDevice(result.device.id);
    }
  }, [dialog, addDevice, selectDevice]);

  const handleConnect = useCallback(() => {
    if (!activeDevice) return;
    if (status === "disconnected" || status === "error") {
      connect();
    } else if (status === "connected") {
      disconnect();
    }
  }, [activeDevice, status, connect, disconnect]);

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
      case "return": {
        const device = devices[safeSelectedIndex];
        if (device) selectDevice(device.id);
        break;
      }
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
        <text fg={TEXT_DIM}>No devices found</text>
      </Panel>
    );
  }

  return (
    <Panel title="DEVICES" width={32} focused={focused}>
      {devices.map((device, index) => (
        <DeviceListItem
          key={device.id}
          device={device}
          isSelected={index === safeSelectedIndex}
          isFocused={focused}
        />
      ))}
      <box marginTop="auto">
        <text fg={TEXT_MUTED}>↑/↓ to navigate</text>
        <HintGroup
          hints={[
            { key: "A", label: "add" },
            { key: "X", label: "remove" },
          ]}
        />
      </box>
    </Panel>
  );
}
