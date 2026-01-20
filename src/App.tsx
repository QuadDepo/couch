import { DialogProvider } from "@opentui-ui/dialog/react";
import type { TVDevice, RemoteKey } from "./types/index.ts";
import { Header } from "./components/layout/Header.tsx";
import { StatusBar } from "./components/layout/StatusBar.tsx";
import { DeviceList } from "./components/devices/DeviceList.tsx";
import { DPad } from "./components/controls/DPad.tsx";
import { useDeviceStore } from "./store/deviceStore";
import { useUIStore } from "./store/uiStore";
import { useDeviceHandler } from "./hooks/useDeviceHandler.ts";
import { usePhilipsPairing } from "./hooks/usePhilipsPairing.tsx";
import { useAppKeyboard } from "./hooks/useAppKeyboard.ts";

function AppContent() {
  const devices = useDeviceStore((s) => s.devices);
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const selectDevice = useDeviceStore((s) => s.selectDevice);

  const focusedSection = useUIStore((s) => s.focusedSection);
  const setFocusedSection = useUIStore((s) => s.setFocusedSection);

  const activeDevice = devices.find((d) => d.id === selectedDeviceId) ?? null;
  const selectedDeviceIndex = devices.findIndex((d) => d.id === selectedDeviceId);

  const { sendKey, disconnect, isImplemented } = useDeviceHandler(activeDevice);
  const { handleConnect } = usePhilipsPairing(activeDevice);

  useAppKeyboard({
    focusedSection,
    setFocusedSection,
    activeDevice,
    onConnect: handleConnect,
    onDisconnect: disconnect,
  });

  const handleCommand = async (key: RemoteKey) => {
    if (!activeDevice || activeDevice.status !== "connected") return;
    const result = await sendKey(key);
    if (!result.success) {
      console.error(`Failed to send ${key}: ${result.error}`);
    }
  };

  const handleSelectedIndexChange = (index: number) => {
    const device = devices[index];
    if (device) {
      selectDevice(device.id);
    }
  };

  const handleDeviceSelect = (device: TVDevice) => {
    selectDevice(device.id);
  };

  return (
    <box flexDirection="column" width="100%" height="100%">
      <Header focusedSection={focusedSection} />

      <box flexDirection="row" flexGrow={1} gap={1}>
        <DeviceList
          devices={devices}
          activeDevice={activeDevice}
          selectedIndex={selectedDeviceIndex === -1 ? 0 : selectedDeviceIndex}
          focused={focusedSection === "devices"}
          onSelectedIndexChange={handleSelectedIndexChange}
          onSelect={handleDeviceSelect}
        />

        <DPad
          enabled={activeDevice?.status === "connected"}
          focused={focusedSection === "dpad"}
          onCommand={handleCommand}
        />
      </box>

      <StatusBar device={activeDevice} isImplemented={isImplemented} />
    </box>
  );
}

export function App() {
  return (
    <DialogProvider size="small">
      <AppContent />
    </DialogProvider>
  );
}
