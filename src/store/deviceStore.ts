import { create } from "zustand";
import { createActor, type Actor, type SnapshotFrom } from "xstate";
import type { TVDevice, ConnectionStatus, DeviceConfig } from "../types";
import { deviceConnectionMachine } from "../machines/deviceConnectionMachine";
import { disposeHandler } from "../devices/factory";
import { logger } from "../utils/logger";
import { loadDevices as loadFromStorage, saveDevices } from "../utils/storage";

type MachineSnapshot = SnapshotFrom<typeof deviceConnectionMachine>;
type ConnectionActor = Actor<typeof deviceConnectionMachine>;

interface DeviceState {
  devices: TVDevice[];
  selectedDeviceId: string | null;
  deviceActors: Map<string, ConnectionActor>;
  isLoaded: boolean;

  loadDevices: () => Promise<TVDevice[] | null>;
  addDevice: (device: TVDevice) => void;
  removeDevice: (deviceId: string) => void;
  selectDevice: (deviceId: string | null) => void;
  updateDeviceConfig: (deviceId: string, config: Partial<DeviceConfig>) => void;

  connectDevice: (deviceId: string) => void;
  disconnectDevice: (deviceId: string) => void;

  getSelectedDevice: () => TVDevice | null;
  getDeviceStatus: (deviceId: string) => ConnectionStatus;
}

const stateToStatus = (state: string): ConnectionStatus => {
  const mapping: Record<string, ConnectionStatus> = {
    disconnected: "disconnected",
    connecting: "connecting",
    connected: "connected",
    retrying: "connecting",
    disconnecting: "connecting",
    error: "error",
  };
  return mapping[state] || "disconnected";
};

export const useDeviceStore = create<DeviceState>((set, get) => ({
  devices: [],
  selectedDeviceId: null,
  deviceActors: new Map(),
  isLoaded: false,

  loadDevices: async () => {
    const devices = await loadFromStorage();
    if (devices) {
      devices.forEach((device) => get().addDevice(device));
      if (devices.length > 0) {
        set({ selectedDeviceId: devices[0]!.id });
      }
    }
    set({ isLoaded: true });
    return devices;
  },

  addDevice: (device) => {
    const actor = createActor(deviceConnectionMachine, {
      input: {
        deviceId: device.id,
        ip: device.ip,
        platform: device.platform,
      },
    });

    actor.subscribe((snapshot: MachineSnapshot) => {
      const machineState = snapshot.value as string;
      const status = stateToStatus(machineState);
      const context = snapshot.context as { retryCount?: number; error?: string };

      logger.state("XState", device.status, status, machineState);
      if (context.retryCount && context.retryCount > 0) {
        logger.info("XState", `Retry attempt ${context.retryCount}`, { deviceId: device.id });
      }
      if (context.error) {
        logger.error("XState", context.error, { deviceId: device.id });
      }

      set((state) => ({
        devices: state.devices.map((d) =>
          d.id === device.id ? { ...d, status } : d
        ),
      }));
    });

    actor.start();

    set((state) => ({
      devices: [...state.devices, device],
      deviceActors: new Map(state.deviceActors).set(device.id, actor),
    }));

    if (get().isLoaded) {
      saveDevices(get().devices);
    }
  },

  removeDevice: (deviceId) => {
    const actor = get().deviceActors.get(deviceId);
    if (actor) {
      actor.stop();
    }
    disposeHandler(deviceId);

    set((state) => {
      const newActors = new Map(state.deviceActors);
      newActors.delete(deviceId);
      return {
        devices: state.devices.filter((d) => d.id !== deviceId),
        deviceActors: newActors,
        selectedDeviceId:
          state.selectedDeviceId === deviceId ? null : state.selectedDeviceId,
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
        d.id === deviceId
          ? { ...d, config: { ...d.config, ...config } }
          : d
      ),
    }));
    logger.info("Store", `Updated device config`, { deviceId, config });

    saveDevices(get().devices);
  },

  connectDevice: (deviceId) => {
    const actor = get().deviceActors.get(deviceId);
    actor?.send({ type: "CONNECT" });
  },

  disconnectDevice: (deviceId) => {
    const actor = get().deviceActors.get(deviceId);
    actor?.send({ type: "DISCONNECT" });
  },

  getSelectedDevice: () => {
    const { devices, selectedDeviceId } = get();
    return devices.find((d) => d.id === selectedDeviceId) || null;
  },

  getDeviceStatus: (deviceId) => {
    const device = get().devices.find((d) => d.id === deviceId);
    return device?.status || "disconnected";
  },
}));
