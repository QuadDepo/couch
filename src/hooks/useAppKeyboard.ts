import { useKeyboard } from "@opentui/react";
import { useDialogState } from "@opentui-ui/dialog/react";

const SECTIONS = ["devices", "dpad"] as const;
type Section = (typeof SECTIONS)[number];

interface UseAppKeyboardOptions {
  focusedSection: Section;
  setFocusedSection: (section: Section) => void;
}

export function useAppKeyboard({
  focusedSection,
  setFocusedSection,
}: UseAppKeyboardOptions): void {
  const isDialogOpen = useDialogState((s) => s.isOpen);
  const cycleSection = (reverse: boolean = false) => {
    const currentIndex = SECTIONS.indexOf(focusedSection);
    const nextIndex = reverse
      ? (currentIndex - 1 + SECTIONS.length) % SECTIONS.length
      : (currentIndex + 1) % SECTIONS.length;
    setFocusedSection(SECTIONS[nextIndex]!);
  };

  useKeyboard((event) => {
    if (isDialogOpen) return;

    if (event.name === "tab") {
      cycleSection(event.shift);
    }
  });
}
