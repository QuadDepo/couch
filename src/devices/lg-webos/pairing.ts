// WebOS TV Pairing Steps

import type { PairingStep } from "../types";

export const pairingSteps: PairingStep[] = [
  {
    id: "start_pairing",
    title: "WebOS TV Pairing",
    description:
      "Make sure your WebOS TV is turned on and connected to the same network as this device.",
    type: "action",
  },
  {
    id: "check_confirmation",
    title: "Confirm on TV",
    description:
      "A pairing request has been sent to your TV. Please confirm the pairing request on your TV screen now, then press Enter to continue.",
    type: "action",
  },
  {
    id: "pairing_complete",
    title: "Pairing Complete",
    description:
      "Your WebOS TV has been paired successfully. The client key has been stored and will be used for future connections.",
    type: "info",
  },
];
