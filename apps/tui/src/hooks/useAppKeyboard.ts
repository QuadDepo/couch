import { useKeyboard } from "@opentui/react";
import { useDialogState } from "@opentui-ui/dialog/react";
import { useUIStore } from "../store/uiStore";

export function useAppKeyboard(): void {
  const focusPath = useUIStore((s) => s.focusPath);
  const setFocusPath = useUIStore((s) => s.setFocusPath);
  const isDialogOpen = useDialogState((s) => s.isOpen);

  useKeyboard((event) => {
    // Only handle when in app scope (not modal)
    if (isDialogOpen) return;

    // Tab cycles through app sections
    if (event.name === "tab") {
      event.preventDefault();
      setFocusPath(focusPath === "app/devices" ? "app/dpad" : "app/devices");
    }
  });
}
