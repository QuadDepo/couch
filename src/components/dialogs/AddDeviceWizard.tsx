import { TextAttributes } from "@opentui/core";
import { type DialogId, type PromptContext, useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useCallback, useState } from "react";
import { implementedPlatforms, wrapPlatformCredentials } from "../../devices/factory.ts";
import type { WizardOutput } from "../../devices/lg-webos/wizard/machine.ts";
import type { TVDevice, TVPlatform } from "../../types/index.ts";
import { AndroidTVWizard } from "./wizard/AndroidTVWizard.tsx";
import { PhilipsWizard } from "./wizard/PhilipsWizard.tsx";
import { WebOSWizard } from "./wizard/WebOSWizard.tsx";

export interface AddDeviceResult {
  device: TVDevice;
}

export function AddDeviceWizard({
  resolve,
  dismiss,
  dialogId,
}: PromptContext<AddDeviceResult | null>) {
  const [selectedPlatform, setSelectedPlatform] = useState<TVPlatform | null>(null);

  const handleComplete = useCallback(
    (output: WizardOutput) => {
      const device: TVDevice = {
        id: crypto.randomUUID(),
        name: output.deviceName,
        ip: output.deviceIp,
        platform: output.platform,
        status: "disconnected",
        config: output.credentials
          ? wrapPlatformCredentials(output.platform, output.credentials)
          : undefined,
      };
      resolve({ device });
    },
    [resolve],
  );

  const handleCancel = useCallback(() => {
    dismiss();
  }, [dismiss]);

  if (!selectedPlatform) {
    return (
      <PlatformSelection
        onSelect={setSelectedPlatform}
        onCancel={handleCancel}
        dialogId={dialogId}
      />
    );
  }

  return (
    <box
      flexDirection="column"
      gap={1}
      paddingLeft={4}
      paddingRight={4}
      paddingTop={2}
      paddingBottom={2}
    >
      {selectedPlatform === "lg-webos" && (
        <WebOSWizard onComplete={handleComplete} onCancel={handleCancel} dialogId={dialogId} />
      )}
      {selectedPlatform === "philips-android-tv" && (
        <PhilipsWizard onComplete={handleComplete} onCancel={handleCancel} dialogId={dialogId} />
      )}
      {selectedPlatform === "android-tv" && (
        <AndroidTVWizard onComplete={handleComplete} onCancel={handleCancel} dialogId={dialogId} />
      )}
    </box>
  );
}

interface PlatformSelectionProps {
  onSelect: (platform: TVPlatform) => void;
  onCancel: () => void;
  dialogId: DialogId;
}

function PlatformSelection({ onSelect, onCancel, dialogId }: PlatformSelectionProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useDialogKeyboard((event) => {
    switch (event.name) {
      case "up":
        setSelectedIndex((i) => Math.max(0, i - 1));
        break;
      case "down":
        setSelectedIndex((i) => Math.min(implementedPlatforms.length - 1, i + 1));
        break;
      case "return": {
        const platform = implementedPlatforms[selectedIndex];
        if (platform) {
          onSelect(platform.id);
        }
        break;
      }
      case "escape":
        onCancel();
        break;
    }
  }, dialogId);

  return (
    <box
      flexDirection="column"
      gap={1}
      paddingLeft={4}
      paddingRight={4}
      paddingTop={2}
      paddingBottom={2}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text fg="#00AAFF" attributes={TextAttributes.BOLD}>
          Add Device
        </text>
      </box>
      <text fg="#888888">Select Platform</text>

      <box marginTop={1} flexDirection="column" gap={1}>
        <text fg="#666666">Select your TV platform:</text>

        <box flexDirection="column" marginTop={1}>
          {implementedPlatforms.map((platform, index) => {
            const isSelected = index === selectedIndex;
            return (
              <box key={platform.id} flexDirection="column" marginBottom={1}>
                <text fg={isSelected ? "#00AAFF" : "#FFFFFF"}>
                  {isSelected ? "> " : "  "}
                  {platform.name}
                </text>
                <text fg="#666666"> {platform.description}</text>
              </box>
            );
          })}
        </box>

        <box marginTop={1} flexDirection="row">
          <text fg="#888888" attributes={TextAttributes.BOLD}>
            Esc
          </text>
          <text fg="#666666"> to close, </text>
          <text fg="#888888" attributes={TextAttributes.BOLD}>
            ↑↓
          </text>
          <text fg="#666666"> to select, </text>
          <text fg="#888888" attributes={TextAttributes.BOLD}>
            Enter
          </text>
          <text fg="#666666"> to continue</text>
        </box>
      </box>
    </box>
  );
}
