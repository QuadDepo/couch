import { createContext, useContext, useMemo } from "react";
import { useSelector } from "@xstate/react";
import type { WizardActorRef } from "../../../machines/addDeviceWizardMachine.ts";
import {
  selectStepLabel,
  selectProgressString,
  selectIsExecutingAction,
  selectIsSubmittingInput,
  selectIsBusy,
  selectCurrentPairingStep,
  selectPairingProgress,
  selectCurrentInput,
  selectError,
} from "../../../machines/addDeviceWizardSelectors.ts";

const WizardContext = createContext<WizardActorRef | null>(null);

export const useWizard = () => {
  const actorRef = useContext(WizardContext);
  if (!actorRef) throw new Error("useWizard must be used within WizardProvider");

  const stepLabel = useSelector(actorRef, selectStepLabel);
  const progressString = useSelector(actorRef, selectProgressString);
  const isExecutingAction = useSelector(actorRef, selectIsExecutingAction);
  const isSubmittingInput = useSelector(actorRef, selectIsSubmittingInput);
  const isBusy = useSelector(actorRef, selectIsBusy);
  const currentPairingStep = useSelector(actorRef, selectCurrentPairingStep);
  const pairingProgress = useSelector(actorRef, selectPairingProgress);
  const currentInput = useSelector(actorRef, selectCurrentInput);
  const error = useSelector(actorRef, selectError);

  return useMemo(
    () => ({
      stepLabel,
      progressString,
      isExecutingAction,
      isSubmittingInput,
      isBusy,
      currentPairingStep,
      pairingProgress,
      currentInput,
      error,
    }),
    [
      stepLabel,
      progressString,
      isExecutingAction,
      isSubmittingInput,
      isBusy,
      currentPairingStep,
      pairingProgress,
      currentInput,
      error,
    ]
  );
};

interface WizardProviderProps {
  actorRef: WizardActorRef;
  children: React.ReactNode;
}

export function WizardProvider({ actorRef, children }: WizardProviderProps) {
  return (
    <WizardContext.Provider value={actorRef}>
      {children}
    </WizardContext.Provider>
  );
}
