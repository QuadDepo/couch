import { useKeyboard } from "@opentui/react";
import { useUIStore } from "../store/uiStore";
import { useDialogState } from "../vendor/dialog/react";

export function useAppKeyboard(): void {
  const focusPath = useUIStore((s) => s.focusPath);
  const setFocusPath = useUIStore((s) => s.setFocusPath);
  const isDialogOpen = useDialogState((s) => s.isOpen);

  useKeyboard((event) => {
    if (isDialogOpen) return;

    if (event.name === "tab") {
      event.preventDefault();
      setFocusPath(focusPath === "app/devices" ? "app/dpad" : "app/devices");
    }
  });
}
