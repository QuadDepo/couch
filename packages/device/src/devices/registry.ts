import { createActor, type InspectionEvent, type Observer } from "xstate";
import type { TVDevice } from "../types";
import type { DeviceActor } from "./actors";
import { capabilities as androidTVCapabilities } from "./android-tv/capabilities";
import { androidTVDeviceMachine } from "./android-tv/machines/device";
import { capabilities as androidTvRemoteCapabilities } from "./android-tv-remote/capabilities";
import { validateAndroidTvRemoteCredentials } from "./android-tv-remote/credentials";
import { androidTvRemoteDeviceMachine } from "./android-tv-remote/machines/device";
import { capabilities as webosCapabilities } from "./lg-webos/capabilities";
import { validateWebOSCredentials } from "./lg-webos/credentials";
import { webosDeviceMachine } from "./lg-webos/machines/device";
import { capabilities as philipsCapabilities } from "./philips-tv/capabilities";
import { validatePhilipsCredentials } from "./philips-tv/credentials";
import { philipsDeviceMachine } from "./philips-tv/machines/device";
import { capabilities as tizenCapabilities } from "./samsung-tizen/capabilities";
import { validateTizenCredentials } from "./samsung-tizen/credentials";
import { tizenDeviceMachine } from "./samsung-tizen/machines/device";
import type { DeviceCapabilities } from "./types";

export interface PlatformRegistration {
  name: string;
  label: string;
  description: string;
  capabilities: DeviceCapabilities;
  createActor: (
    device: TVDevice,
    inspect?: Observer<InspectionEvent> | ((event: InspectionEvent) => void),
  ) => DeviceActor;
  wrapCredentials: (raw: unknown) => TVDevice["config"];
}

export type ImplementedPlatform =
  | "lg-webos"
  | "android-tv"
  | "philips-tv"
  | "samsung-tizen"
  | "android-tv-remote";

export const platformRegistry: Record<ImplementedPlatform, PlatformRegistration> = {
  "lg-webos": {
    name: "LG WebOS TV",
    label: "LG",
    description: "LG WebOS TVs (via WebSocket)",
    capabilities: webosCapabilities,
    createActor: (device, inspect) => {
      const config = device.config as { webos?: unknown } | undefined;
      return createActor(webosDeviceMachine, {
        input: {
          deviceId: device.id,
          deviceName: device.name,
          deviceIp: device.ip,
          platform: "lg-webos",
          credentials: config?.webos,
        },
        inspect,
      });
    },
    wrapCredentials: (raw) => ({ webos: validateWebOSCredentials(raw) }),
  },

  "android-tv": {
    name: "Android TV (ADB)",
    label: "Android",
    description: "Android TVs via ADB debugging",
    capabilities: androidTVCapabilities,
    createActor: (device, inspect) =>
      createActor(androidTVDeviceMachine, {
        input: {
          deviceId: device.id,
          deviceName: device.name,
          deviceIp: device.ip,
          platform: "android-tv",
        },
        inspect,
      }),
    wrapCredentials: () => undefined,
  },

  "philips-tv": {
    name: "Philips TV",
    label: "Philips",
    description: "Philips TVs (via JointSpace)",
    capabilities: philipsCapabilities,
    createActor: (device, inspect) => {
      const config = device.config as { philips?: unknown } | undefined;
      return createActor(philipsDeviceMachine, {
        input: {
          deviceId: device.id,
          deviceName: device.name,
          deviceIp: device.ip,
          platform: "philips-tv",
          credentials: config?.philips,
        },
        inspect,
      });
    },
    wrapCredentials: (raw) => ({ philips: validatePhilipsCredentials(raw) }),
  },

  "samsung-tizen": {
    name: "Samsung Tizen TV",
    label: "Samsung",
    description: "Samsung Tizen TVs (via WebSocket)",
    capabilities: tizenCapabilities,
    createActor: (device, inspect) => {
      const config = device.config as { tizen?: unknown } | undefined;
      return createActor(tizenDeviceMachine, {
        input: {
          deviceId: device.id,
          deviceName: device.name,
          deviceIp: device.ip,
          platform: "samsung-tizen",
          credentials: config?.tizen,
        },
        inspect,
      });
    },
    wrapCredentials: (raw) => ({ tizen: validateTizenCredentials(raw) }),
  },

  "android-tv-remote": {
    name: "Android TV (Remote Protocol)",
    label: "Android (Remote)",
    description: "Android TVs via TLS remote protocol",
    capabilities: androidTvRemoteCapabilities,
    createActor: (device, inspect) => {
      const config = device.config as { androidTvRemote?: unknown } | undefined;
      return createActor(androidTvRemoteDeviceMachine, {
        input: {
          deviceId: device.id,
          deviceName: device.name,
          deviceIp: device.ip,
          platform: "android-tv-remote",
          credentials: config?.androidTvRemote,
        },
        inspect,
      });
    },
    wrapCredentials: (raw) => ({
      androidTvRemote: validateAndroidTvRemoteCredentials(raw),
    }),
  },
};
