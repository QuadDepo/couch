import { type ImplementedPlatform, implementedPlatforms } from "@couch/device";
import { TextAttributes } from "@opentui/core";
import { type ReactNode, useCallback, useState } from "react";
import { AndroidTVPairingFlow } from "../../devices/android-tv/ui/flow.tsx";
import { AndroidTvRemotePairingFlow } from "../../devices/android-tv-remote/ui/flow.tsx";
import { WebOSPairingFlow } from "../../devices/lg-webos/ui/flow.tsx";
import { PhilipsPairingFlow } from "../../devices/philips-tv/ui/flow.tsx";
import { TizenPairingFlow } from "../../devices/samsung-tizen/ui/flow.tsx";
import { type PromptContext, useDialogKeyboard } from "../../vendor/dialog/react";
import { PlatformSelectionStep } from "./wizard/PlatformSelectionStep.tsx";
import type { PairingFlowProps, PairingFlowResult } from "./wizard/types.ts";

export type { PairingFlowResult as AddDeviceResult };

type PairingFlowComponent = (props: PairingFlowProps) => ReactNode;

const PLATFORM_FLOWS: Record<ImplementedPlatform, PairingFlowComponent> = {
  "lg-webos": WebOSPairingFlow,
  "android-tv": AndroidTVPairingFlow,
  "android-tv-remote": AndroidTvRemotePairingFlow,
  "philips-tv": PhilipsPairingFlow,
  "samsung-tizen": TizenPairingFlow,
};

export function AddDeviceWizard({
  resolve,
  dismiss,
  dialogId,
}: PromptContext<PairingFlowResult | null>) {
  const [platform, setPlatform] = useState<ImplementedPlatform | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const handleComplete = useCallback(
    (result: PairingFlowResult) => {
      resolve(result);
    },
    [resolve],
  );

  const handleBackToPlatformSelection = useCallback(() => {
    setPlatform(null);
  }, []);

  useDialogKeyboard((event) => {
    // Platform-selection phase only. Once a platform is chosen the active flow
    // owns keyboard handling (char/backspace/tab/enter, escape, and back).
    if (platform) return;

    switch (event.name) {
      case "up":
        setSelectedIndex((i) => Math.max(0, i - 1));
        break;
      case "down":
        setSelectedIndex((i) => Math.min(implementedPlatforms.length - 1, i + 1));
        break;
      case "return": {
        const selectedPlatform = implementedPlatforms[selectedIndex];
        if (selectedPlatform) {
          setPlatform(selectedPlatform.id as ImplementedPlatform);
        }
        break;
      }
      case "escape":
        dismiss();
        break;
    }
  }, dialogId);

  // Platform selection phase
  if (!platform) {
    return (
      <box
        flexDirection="column"
        gap={1}
        paddingLeft={4}
        paddingRight={4}
        paddingTop={2}
        paddingBottom={2}
      >
        <text attributes={TextAttributes.BOLD}>Select Platform</text>
        <box marginTop={1}>
          <PlatformSelectionStep selectedPlatformIndex={selectedIndex} />
        </box>
      </box>
    );
  }

  // Platform-specific flow phase
  const FlowComponent = PLATFORM_FLOWS[platform];
  return (
    <FlowComponent
      dialogId={dialogId}
      onComplete={handleComplete}
      onCancel={dismiss}
      onBackToPlatformSelection={handleBackToPlatformSelection}
    />
  );
}
