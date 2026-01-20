import type { PairingStep } from "../types";

export const pairingSteps: PairingStep[] = [
  {
    id: "enable_dev_options",
    title: "Enable Developer Options",
    description: "Go to Settings > Device Preferences > About and tap Build number 7 times",
    type: "action",
  },
  {
    id: "enable_wireless_debug",
    title: "Enable Wireless Debugging",
    description: "Go to Settings > Device Preferences > Developer options and enable Wireless debugging",
    type: "action",
  },
  {
    id: "get_pairing_code",
    title: "Get Pairing Code",
    description: "In Wireless debugging settings, tap 'Pair device with pairing code' and note the code and port",
    type: "action",
  },
  {
    id: "enter_pairing_port",
    title: "Enter Pairing Port",
    description: "Enter the pairing port shown on your TV (e.g., 37755)",
    type: "input",
    inputType: "text",
  },
  {
    id: "enter_pairing_code",
    title: "Enter Pairing Code",
    description: "Enter the 6-digit pairing code shown on your TV",
    type: "input",
    inputType: "pin",
  },
  {
    id: "pairing",
    title: "Pairing...",
    description: "Connecting to your Android TV",
    type: "waiting",
  },
];
