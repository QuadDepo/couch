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

    // Tab cycles through sections (in both directions)
    if (event.name === "tab") {
      event.preventDefault();
      cycleSection(event.shift);
    }
  });
}
