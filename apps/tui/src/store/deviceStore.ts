import {
  type DeviceActor,
  loadDevices as loadFromStorage,
  logger,
  type StoredDeviceActor,
  saveDevices,
  type TVDevice,
} from "@couch/device";
import { create } from "zustand";
import { inspector } from "../utils/inspector.ts";
import { lookupPlatformRegistration } from "../utils/platformRegistry.ts";

interface DeviceState {
  devices: TVDevice[];
  selectedDeviceId: string | null;
  deviceActors: Map<string, StoredDeviceActor>;
  isLoaded: boolean;

  loadDevices: () => Promise<TVDevice[] | null>;
  addDevice: (device: TVDevice, actor?: DeviceActor) => void;
  removeDevice: (deviceId: string) => void;
  selectDevice: (deviceId: string | null) => void;
}

const createPlatformActor = (device: TVDevice): DeviceActor => {
  const registration = lookupPlatformRegistration(device.platform);
  if (!registration) {
    throw new Error(`Unsupported platform: ${device.platform}`);
  }
  return registration.createActor(device, inspector?.inspect);
};

function logPersistenceFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  logger.error("Store", `Failed to persist devices: ${message}`);
}

function persistDevices(devices: TVDevice[]): void {
  void saveDevices(devices).catch(logPersistenceFailure);
}

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
    const actor = existingActor ?? createPlatformActor(device);
    const stored: StoredDeviceActor = { platform: device.platform, actor };

    // Always start actor - safe to call on already-started actors (no-op)
    // Handles: newly created actors, and actors stopped by wizard unmount race
    actor.start();

    set((state) => ({
      devices: [...state.devices, device],
      deviceActors: new Map(state.deviceActors).set(device.id, stored),
    }));

    if (get().isLoaded) {
      persistDevices(get().devices);
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
        devices: state.devices.filter((device) => device.id !== deviceId),
        deviceActors: newActors,
        selectedDeviceId: state.selectedDeviceId === deviceId ? null : state.selectedDeviceId,
      };
    });

    persistDevices(get().devices);
  },

  selectDevice: (deviceId) => {
    set({ selectedDeviceId: deviceId });
  },
}));

export const useSelectedDevice = () =>
  useDeviceStore((s) => s.devices.find((device) => device.id === s.selectedDeviceId) ?? null);
