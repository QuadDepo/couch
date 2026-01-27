import { DialogProvider } from "@opentui-ui/dialog/react";
import { DPad } from "./components/controls/DPad.tsx";
import { DeviceList } from "./components/devices/DeviceList.tsx";
import { Header } from "./components/layout/Header.tsx";
import { StatusBar } from "./components/layout/StatusBar.tsx";
import { useAppKeyboard } from "./hooks/useAppKeyboard.ts";
import { useDeviceHandler } from "./hooks/useDeviceHandler.ts";
import { useDeviceStore } from "./store/deviceStore";
import { useUIStore } from "./store/uiStore";
import type { RemoteKey } from "./types/index.ts";

function AppContent() {
  const devices = useDeviceStore((s) => s.devices);
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);

  const focusPath = useUIStore((s) => s.focusPath);

  const activeDevice = devices.find((d) => d.id === selectedDeviceId) ?? null;

  const { status, sendKey, sendText, isImplemented, capabilities } = useDeviceHandler(activeDevice);

  useAppKeyboard();

  const handleCommand = async (key: RemoteKey) => {
    if (!activeDevice || status !== "connected") return;
    const result = await sendKey(key);
    if (!result.success) {
      console.error(`Failed to send ${key}: ${result.error}`);
    }
  };

  return (
    <box flexDirection="column" width="100%" height="100%">
      <Header focusPath={focusPath} />

      <box flexDirection="row" flexGrow={1} gap={1}>
        <DeviceList focused={focusPath === "app/devices"} />

        <DPad
          enabled={status === "connected"}
          focused={focusPath === "app/dpad"}
          onCommand={handleCommand}
          sendText={sendText}
          deviceType={activeDevice?.platform ?? null}
          textInputSupported={capabilities?.textInputSupported ?? false}
        />
      </box>

      <StatusBar device={activeDevice} status={status} isImplemented={isImplemented} />
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
