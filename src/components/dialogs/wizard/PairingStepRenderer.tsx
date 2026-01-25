import { forwardRef, useImperativeHandle, useRef } from "react";
import type { ActorRefFrom } from "xstate";
import type { androidTvPairingMachine } from "../../../devices/android-tv/machine.ts";
import { AndroidTvPairingUI } from "../../../devices/android-tv/PairingUI.tsx";
import type { webosPairingMachine } from "../../../devices/lg-webos/machine.ts";
import { WebOSPairingUI } from "../../../devices/lg-webos/PairingUI.tsx";
import type { philipsPairingMachine } from "../../../devices/philips-android-tv/machine.ts";
import { PhilipsPairingUI } from "../../../devices/philips-android-tv/PairingUI.tsx";
import type { PairingHandle } from "../../../machines/pairing/types.ts";
import { useWizard } from "./WizardProvider.tsx";

export type PairingStepHandle = PairingHandle;

export const PairingStepRenderer = forwardRef<PairingStepHandle>(
  function PairingStepRenderer(_props, ref) {
    const { platform, pairingActorRef } = useWizard();
    const pairingRef = useRef<PairingHandle>(null);

    useImperativeHandle(
      ref,
      () => ({
        handleChar: (char: string) => pairingRef.current?.handleChar(char),
        handleBackspace: () => pairingRef.current?.handleBackspace(),
        handleSubmit: () => pairingRef.current?.handleSubmit(),
      }),
      [],
    );

    if (!pairingActorRef) {
      return <text fg="#FF4444">Error: No pairing actor available</text>;
    }

    switch (platform) {
      case "android-tv":
        return (
          <AndroidTvPairingUI
            ref={pairingRef}
            actorRef={pairingActorRef as ActorRefFrom<typeof androidTvPairingMachine>}
          />
        );
      case "lg-webos":
        return (
          <WebOSPairingUI
            ref={pairingRef}
            actorRef={pairingActorRef as ActorRefFrom<typeof webosPairingMachine>}
          />
        );
      case "philips-android-tv":
        return (
          <PhilipsPairingUI
            ref={pairingRef}
            actorRef={pairingActorRef as ActorRefFrom<typeof philipsPairingMachine>}
          />
        );
      default:
        return <text fg="#FF4444">Unknown platform: {platform}</text>;
    }
  },
);
