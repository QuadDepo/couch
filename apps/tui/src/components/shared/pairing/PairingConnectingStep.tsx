import { TEXT_SECONDARY, WARNING_COLOR } from "../../../constants/colors.ts";

interface PairingConnectingStepProps {
  brandName?: string;
  title?: string;
  subtext?: string;
}

export function PairingConnectingStep({ brandName, title, subtext }: PairingConnectingStepProps) {
  const primaryLine =
    title ?? `Make sure your ${brandName} is turned on and connected to the same network.`;
  const secondaryLine = subtext ?? "Connecting to TV...";

  return (
    <>
      <text fg={TEXT_SECONDARY}>{primaryLine}</text>
      <text fg={WARNING_COLOR} marginTop={1}>
        {secondaryLine}
      </text>
    </>
  );
}
