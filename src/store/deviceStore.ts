import { createActor } from "xstate";
import { create } from "zustand";
import type { DeviceActor, StoredDeviceActor } from "../devices/actors";
import { androidTVDeviceMachine } from "../devices/android-tv/machines/device";
import { webosDeviceMachine } from "../devices/lg-webos/machines/device";
import { philipsDeviceMachine } from "../devices/philips-android-tv/machines/device";
import type { TVDevice } from "../types";
import { inspector } from "../utils/inspector";
import { logger } from "../utils/logger";
import { loadDevices as loadFromStorage, saveDevices } from "../utils/storage";

export type { DeviceActor, StoredDeviceActor } from "../devices/actors";

interface DeviceState {
  devices: TVDevice[];
  selectedDeviceId: string | null;
  deviceActors: Map<string, StoredDeviceActor>;
  isLoaded: boolean;

  loadDevices: () => Promise<TVDevice[] | null>;
  addDevice: (device: TVDevice, actor?: DeviceActor) => void;
  removeDevice: (deviceId: string) => void;
  selectDevice: (deviceId: string | null) => void;
  updateDeviceConfig: (deviceId: string, config: Partial<TVDevice["config"]>) => void;
  getSelectedDevice: () => TVDevice | null;
}

const createPlatformActor = (device: TVDevice): DeviceActor => {
  const config = device.config as { webos?: unknown; philips?: unknown } | undefined;

  switch (device.platform) {
    case "lg-webos":
      return createActor(webosDeviceMachine, {
        input: {
          deviceId: device.id,
          deviceName: device.name,
          deviceIp: device.ip,
          platform: "lg-webos",
          credentials: config?.webos,
        },
        inspect: inspector?.inspect,
      });

    case "android-tv":
      return createActor(androidTVDeviceMachine, {
        input: {
          deviceId: device.id,
          deviceName: device.name,
          deviceIp: device.ip,
          platform: "android-tv",
        },
        inspect: inspector?.inspect,
      });

    case "philips-android-tv":
      return createActor(philipsDeviceMachine, {
        input: {
          deviceId: device.id,
          deviceName: device.name,
          deviceIp: device.ip,
          platform: "philips-android-tv",
          credentials: config?.philips,
        },
        inspect: inspector?.inspect,
      });

    default:
      throw new Error(`Unsupported platform: ${device.platform}`);
  }
};

export const useDeviceStore = create<DeviceState>((set, get) => ({
  devices: [],
  selectedDeviceId: null,
  deviceActors: new Map(),
  isLoaded: false,

  loadDevices: async () => {
    const devices = await loadFromStorage();
    if (devices) {
      for (const device of devices) {
        get().addDevice(device);
      }
      if (devices.length > 0) {
        set({ selectedDeviceId: devices[0]?.id });
      }
    }
    set({ isLoaded: true });
    return devices;
  },

  addDevice: (device, existingActor) => {
    // Use existing actor or create a new one
    const actor = existingActor ?? createPlatformActor(device);
    const stored: StoredDeviceActor = { platform: device.platform, actor };

    // Ensure actor is running (may have been stopped by wizard unmount race condition)
    if (actor.getSnapshot().status !== "active") {
      actor.start();
    }

    set((state) => ({
      devices: [...state.devices, device],
      deviceActors: new Map(state.deviceActors).set(device.id, stored),
    }));

    if (get().isLoaded) {
      saveDevices(get().devices);
    }

    if (existingActor) {
      logger.info("Store", `Added device with existing actor: ${device.name}`, {
        deviceId: device.id,
      });
    }
  },

  removeDevice: (deviceId) => {
    const stored = get().deviceActors.get(deviceId);
    if (stored) {
      stored.actor.stop();
    }

    set((state) => {
      const newActors = new Map(state.deviceActors);
      newActors.delete(deviceId);
      return {
        devices: state.devices.filter((d) => d.id !== deviceId),
        deviceActors: newActors,
        selectedDeviceId: state.selectedDeviceId === deviceId ? null : state.selectedDeviceId,
      };
    });

    saveDevices(get().devices);
  },

  selectDevice: (deviceId) => {
    set({ selectedDeviceId: deviceId });
  },

  updateDeviceConfig: (deviceId, config) => {
    set((state) => ({
      devices: state.devices.map((d) =>
        d.id === deviceId ? { ...d, config: { ...d.config, ...config } } : d,
      ),
    }));
    logger.info("Store", `Updated device config`, { deviceId, config });

    saveDevices(get().devices);
  },

  getSelectedDevice: () => {
    const { devices, selectedDeviceId } = get();
    return devices.find((d) => d.id === selectedDeviceId) || null;
  },
}));

// Selector hook for selected device - only re-renders when selected device changes
export const useSelectedDevice = () =>
  useDeviceStore((s) => s.devices.find((d) => d.id === s.selectedDeviceId) ?? null);
