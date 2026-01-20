import { useKeyboard } from "@opentui/react";
import type { TVDevice } from "../types";

const SECTIONS = ["devices", "dpad"] as const;
export type Section = (typeof SECTIONS)[number];

interface UseAppKeyboardOptions {
  focusedSection: Section;
  setFocusedSection: (section: Section) => void;
  activeDevice: TVDevice | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function useAppKeyboard({
  focusedSection,
  setFocusedSection,
  activeDevice,
  onConnect,
  onDisconnect,
}: UseAppKeyboardOptions): void {
  const cycleSection = (reverse: boolean = false) => {
    const currentIndex = SECTIONS.indexOf(focusedSection);
    const nextIndex = reverse
      ? (currentIndex - 1 + SECTIONS.length) % SECTIONS.length
      : (currentIndex + 1) % SECTIONS.length;
    setFocusedSection(SECTIONS[nextIndex]!);
  };

  useKeyboard((event) => {
    if (event.name === "tab") {
      cycleSection(event.shift);
    }
    if (event.name === "c" && activeDevice) {
      if (activeDevice.status === "disconnected" || activeDevice.status === "error") {
        onConnect();
      } else if (activeDevice.status === "connected") {
        onDisconnect();
      }
    }
  });
}
