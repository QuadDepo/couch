import { implementedPlatforms } from "@couch/devices";
import { TextAttributes } from "@opentui/core";
import { type PromptContext, useDialogKeyboard } from "@opentui-ui/dialog/react";
import {
  type ForwardRefExoticComponent,
  type RefAttributes,
  useCallback,
  useRef,
  useState,
} from "react";
import { AndroidTVPairingFlow } from "../../devices/android-tv/ui/flow.tsx";
import { AndroidTvRemotePairingFlow } from "../../devices/android-tv-remote/ui/flow.tsx";
import { WebOSPairingFlow } from "../../devices/lg-webos/ui/flow.tsx";
import { PhilipsPairingFlow } from "../../devices/philips-tv/ui/flow.tsx";
import { TizenPairingFlow } from "../../devices/samsung-tizen/ui/flow.tsx";
import { PlatformSelectionStep } from "./wizard/PlatformSelectionStep.tsx";
import type { PairingFlowHandle, PairingFlowProps, PairingFlowResult } from "./wizard/types.ts";

export type ImplementedPlatform =
  | "lg-webos"
  | "android-tv"
  | "android-tv-remote"
  | "philips-tv"
  | "samsung-tizen";

export type { PairingFlowResult as AddDeviceResult };

type PairingFlowComponent = ForwardRefExoticComponent<
  PairingFlowProps & RefAttributes<PairingFlowHandle>
>;

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
  const flowRef = useRef<PairingFlowHandle>(null);

  const [platform, setPlatform] = useState<ImplementedPlatform | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const handleComplete = useCallback(
    (result: PairingFlowResult) => {
      resolve(result);
    },
    [resolve],
  );

  const handleCancel = useCallback(() => {
    flowRef.current?.cleanup();
    dismiss();
  }, [dismiss]);

  const handleBackToPlatformSelection = useCallback(() => {
    setPlatform(null);
  }, []);

  useDialogKeyboard((event) => {
    // Platform selection phase
    if (!platform) {
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
          handleCancel();
          break;
      }
      return;
    }

    // Platform flow phase - delegate to flow via ref
    if (event.name === "escape") {
      handleCancel();
      return;
    }

    if (event.name === "backspace" && event.ctrl) {
      if (flowRef.current?.canGoBack()) {
        const shouldExitToSelection = flowRef.current.handleBack();
        if (shouldExitToSelection) {
          handleBackToPlatformSelection();
        }
      }
      return;
    }

    switch (event.name) {
      case "return":
        if (flowRef.current?.canContinue()) {
          flowRef.current.handleContinue();
        }
        break;
      case "backspace":
        flowRef.current?.handleBackspace();
        break;
      case "tab":
        flowRef.current?.handleTab();
        break;
      default:
        if (event.sequence?.length === 1) {
          flowRef.current?.handleChar(event.sequence);
        }
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
  return <FlowComponent ref={flowRef} onComplete={handleComplete} />;
}
