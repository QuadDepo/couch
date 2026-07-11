import type { ReactNode } from "react";
import { PairingStepLayout } from "./PairingStepLayout.tsx";

interface Hint {
  key: string;
  label: string;
}

// One pairing sub-state: its activation flag, the hints to show, and the body
// to render. Declaring states as data keeps each one handled in exactly one
// place instead of a getHints/renderStep pair that can drift.
export interface PairingState {
  active: boolean;
  hints: Hint[];
  content: ReactNode;
}

interface PairingStateViewProps {
  title: string;
  states: PairingState[];
}

export function PairingStateView({ title, states }: PairingStateViewProps) {
  const current = states.find((state) => state.active);

  return (
    <PairingStepLayout title={title} hints={current?.hints ?? []}>
      {current?.content ?? null}
    </PairingStepLayout>
  );
}
