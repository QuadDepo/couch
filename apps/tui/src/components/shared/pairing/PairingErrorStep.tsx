import { ERROR_COLOR, TEXT_SECONDARY } from "@couch/devices";

interface PairingErrorStepProps {
  error?: string;
}

export function PairingErrorStep({ error }: PairingErrorStepProps) {
  return (
    <>
      <text fg={ERROR_COLOR}>{error || "Connection failed"}</text>
      <text fg={TEXT_SECONDARY} marginTop={1}>
        Make sure your TV is on and connected to the same network.
      </text>
    </>
  );
}
