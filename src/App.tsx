import { DialogProvider } from "@opentui-ui/dialog/react";
import type { RemoteKey } from "./types/index.ts";
import { Header } from "./components/layout/Header.tsx";
import { StatusBar } from "./components/layout/StatusBar.tsx";
import { DeviceList } from "./components/devices/DeviceList.tsx";
import { DPad } from "./components/controls/DPad.tsx";
import { useDeviceStore } from "./store/deviceStore";
import { useUIStore } from "./store/uiStore";
import { useDeviceHandler } from "./hooks/useDeviceHandler.ts";
import { useAppKeyboard } from "./hooks/useAppKeyboard.ts";

function AppContent() {
  const devices = useDeviceStore((s) => s.devices);
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);

  const focusedSection = useUIStore((s) => s.focusedSection);
  const setFocusedSection = useUIStore((s) => s.setFocusedSection);

  const activeDevice = devices.find((d) => d.id === selectedDeviceId) ?? null;

  const { sendKey, sendText, isImplemented, capabilities } = useDeviceHandler(activeDevice);

  useAppKeyboard({
    focusedSection,
    setFocusedSection,
  });

  const handleCommand = async (key: RemoteKey) => {
    if (!activeDevice || activeDevice.status !== "connected") return;
    const result = await sendKey(key);
    if (!result.success) {
      console.error(`Failed to send ${key}: ${result.error}`);
    }
  };

  return (
    <box flexDirection="column" width="100%" height="100%">
      <Header focusedSection={focusedSection} />

      <box flexDirection="row" flexGrow={1} gap={1}>
        <DeviceList focused={focusedSection === "devices"} />

        <DPad
          enabled={activeDevice?.status === "connected"}
          focused={focusedSection === "dpad"}
          onCommand={handleCommand}
          sendText={sendText}
          deviceType={activeDevice?.platform ?? null}
          textInputSupported={capabilities?.textInputSupported ?? false}
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
