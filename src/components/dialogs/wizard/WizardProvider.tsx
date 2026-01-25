import { useSelector } from "@xstate/react";
import { createContext, useContext, useMemo } from "react";
import type { WizardActorRef } from "../../../machines/addDeviceWizardMachine.ts";
import {
  selectError,
  selectPairingActorRef,
  selectPlatform,
  selectProgressString,
  selectStepLabel,
} from "../../../machines/addDeviceWizardSelectors.ts";

interface WizardContextValue {
  actorRef: WizardActorRef;
}

const WizardContext = createContext<WizardContextValue | null>(null);

const useWizardActorRef = () => {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error("useWizardActorRef must be used within WizardProvider");
  return ctx.actorRef;
};

export const useWizard = () => {
  const actorRef = useWizardActorRef();

  const stepLabel = useSelector(actorRef, selectStepLabel);
  const progressString = useSelector(actorRef, selectProgressString);
  const error = useSelector(actorRef, selectError);
  const platform = useSelector(actorRef, selectPlatform);
  const pairingActorRef = useSelector(actorRef, selectPairingActorRef);

  return useMemo(
    () => ({
      actorRef,
      stepLabel,
      progressString,
      error,
      platform,
      pairingActorRef,
    }),
    [actorRef, stepLabel, progressString, error, platform, pairingActorRef],
  );
};

interface WizardProviderProps {
  actorRef: WizardActorRef;
  children: React.ReactNode;
}

export function WizardProvider({ actorRef, children }: WizardProviderProps) {
  return <WizardContext.Provider value={{ actorRef }}>{children}</WizardContext.Provider>;
}
