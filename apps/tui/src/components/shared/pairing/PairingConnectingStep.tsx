import { TEXT_SECONDARY, WARNING_COLOR } from "@couch/devices";

interface PairingConnectingStepProps {
  brandName: string;
}

export function PairingConnectingStep({ brandName }: PairingConnectingStepProps) {
  return (
    <>
      <text fg={TEXT_SECONDARY}>
        Make sure your {brandName} is turned on and connected to the same network.
      </text>
      <text fg={WARNING_COLOR} marginTop={1}>
        Connecting to TV...
      </text>
    </>
  );
}
