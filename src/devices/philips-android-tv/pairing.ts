import type { PairingStep } from "../types";

export const pairingSteps = [
  {
    id: "start_pairing",
    title: "Start Pairing",
    description: "A PIN code will appear on your Philips TV screen.",
    type: "action",
  },
  {
    id: "enter_pin",
    title: "Enter PIN",
    description: "Enter the 4-digit PIN code displayed on your TV.",
    type: "input",
    inputType: "pin",
  },
  {
    id: "pairing_complete",
    title: "Pairing Complete",
    description: "Your Philips TV is now paired and ready to use.",
    type: "info",
  },
] as const satisfies readonly PairingStep[];
