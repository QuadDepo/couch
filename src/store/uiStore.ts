import { create } from "zustand";

type FocusPath =
  | "app/dpad"
  | "app/devices"
  | "modal/text-input"
  | "modal/wizard"
  | "modal/add-device";

interface UIState {
  focusPath: FocusPath;
  setFocusPath: (path: FocusPath) => void;
}

export const useUIStore = create<UIState>((set) => ({
  focusPath: "app/dpad",
  setFocusPath: (path) => set({ focusPath: path }),
}));
