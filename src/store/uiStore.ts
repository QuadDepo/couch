import { create } from "zustand";

type Section = "devices" | "dpad";

interface UIState {
  focusedSection: Section;
  setFocusedSection: (section: Section) => void;
}

export const useUIStore = create<UIState>((set) => ({
  focusedSection: "dpad",
  setFocusedSection: (section) => set({ focusedSection: section }),
}));
