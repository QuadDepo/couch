import { useKeyboard } from "@opentui/react";
import { useUIStore } from "../store/uiStore";

export function useAppKeyboard(): void {
  const focusPath = useUIStore((s) => s.focusPath);
  const setFocusPath = useUIStore((s) => s.setFocusPath);

  useKeyboard((event) => {
    // Only handle when in app scope (not modal)
    if (!focusPath.startsWith("app/")) return;

    // Tab cycles through app sections
    if (event.name === "tab") {
      event.preventDefault();
      setFocusPath(focusPath === "app/devices" ? "app/dpad" : "app/devices");
    }
  });
}
