import { DialogProvider } from "@opentui-ui/dialog/react";
import { DPad } from "./components/controls/DPad.tsx";
import { DeviceList } from "./components/devices/DeviceList.tsx";
import { Header } from "./components/layout/Header.tsx";
import { StatusBar } from "./components/layout/StatusBar.tsx";
import { useAppKeyboard } from "./hooks/useAppKeyboard.ts";
import { useUIStore } from "./store/uiStore";

function AppContent() {
  const focusPath = useUIStore((s) => s.focusPath);

  useAppKeyboard();

  return (
    <box flexDirection="column" width="100%" height="100%">
      <Header focusPath={focusPath} />

      <box flexDirection="row" flexGrow={1} gap={1}>
        <DeviceList focused={focusPath === "app/devices"} />
        <DPad focused={focusPath === "app/dpad"} />
      </box>

      <StatusBar />
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
