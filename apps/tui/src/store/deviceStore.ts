import {
  type DeviceActor,
  type ImplementedPlatform,
  loadDevices as loadFromStorage,
  logger,
  platformRegistry,
  type StoredDeviceActor,
  saveDevices,
  type TVDevice,
} from "@couch/device";
import { create } from "zustand";
import { inspector } from "../utils/inspector.ts";

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
  const registration = platformRegistry[device.platform as ImplementedPlatform];
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
  try {
    void saveDevices(devices).catch(logPersistenceFailure);
  } catch (error) {
    logPersistenceFailure(error);
  }
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
    // Use existing actor or create a new one
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
        devices: state.devices.filter((d) => d.id !== deviceId),
        deviceActors: newActors,
        selectedDeviceId: state.selectedDeviceId === deviceId ? null : state.selectedDeviceId,
      };
    });

    persistDevices(get().devices);
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
    logger.info("Store", `Updated device config`, {
      deviceId,
      configKeys: Object.keys(config ?? {}),
    });

    persistDevices(get().devices);
  },

  getSelectedDevice: () => {
    const { devices, selectedDeviceId } = get();
    return devices.find((d) => d.id === selectedDeviceId) || null;
  },
}));

// Selector hook for selected device - only re-renders when selected device changes
export const useSelectedDevice = () =>
  useDeviceStore((s) => s.devices.find((d) => d.id === s.selectedDeviceId) ?? null);
