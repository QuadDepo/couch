import type { PairingStep } from "../types";

// TODO: Research and implement full "Pair New Device" flow for Android 11+ wireless debugging.
// This would require:
// 1. User taps "Pair device with pairing code" in Wireless Debugging settings
// 2. User enters the pairing port and 6-digit code shown on TV
// 3. Run `adb pair <ip>:<pairing_port> <code>`
// 4. Then connect on the wireless debugging port (different from 5555)
// See: https://developer.android.com/tools/adb#wireless-android11-command-line

// Current flow: Simple direct ADB connect (works when ADB debugging is already enabled)
export const pairingSteps: PairingStep[] = [
  {
    id: "enable_dev_options",
    title: "Enable Developer Options",
    description: "Go to Settings > Device Preferences > About and tap Build number 7 times",
    type: "info",
  },
  {
    id: "enable_adb",
    title: "Enable ADB Debugging",
    description:
      "Go to Settings > Device Preferences > Developer options and enable 'Network debugging' or 'ADB debugging'",
    type: "info",
  },
  {
    id: "connecting",
    title: "Connecting",
    description: "Attempting to connect to your Android TV via ADB...",
    type: "action",
  },
];
