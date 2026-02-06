import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { TVDevice } from "@couch/devices";
import { createActor, createMachine } from "xstate";

const loadDevicesMock = mock(() => Promise.resolve(null));
const saveDevicesMock = mock(() => Promise.resolve());
const loggerMock = {
  error: mock(() => {}),
  info: mock(() => {}),
  warn: mock(() => {}),
};
const machine = createMachine({ id: "mock", initial: "idle", states: { idle: {} } });

mock.module("@couch/devices", () => ({
  androidTVDeviceMachine: machine,
  inspector: null,
  loadDevices: loadDevicesMock,
  logger: loggerMock,
  philipsDeviceMachine: machine,
  saveDevices: saveDevicesMock,
  tizenDeviceMachine: machine,
  webosDeviceMachine: machine,
}));

const { useDeviceStore } = await import("./deviceStore");

function createMockActor() {
  // Cast needed because the store expects a DeviceActor union type
  return createActor(machine) as unknown as ReturnType<typeof createActor>;
}

function makeDevice(overrides?: Partial<TVDevice>): TVDevice {
  return {
    id: overrides?.id ?? "device-1",
    name: overrides?.name ?? "Test TV",
    platform: overrides?.platform ?? "android-tv",
    ip: overrides?.ip ?? "192.168.1.100",
    ...overrides,
  };
}

describe("deviceStore", () => {
  beforeEach(() => {
    mock.clearAllMocks();

    useDeviceStore.setState({
      devices: [],
      selectedDeviceId: null,
      deviceActors: new Map(),
      isLoaded: false,
    });
  });

  test("should add a device and start its actor", () => {
    const actor = createMockActor();
    const device = makeDevice();

    useDeviceStore.getState().addDevice(device, actor as never);

    const state = useDeviceStore.getState();
    expect(state.devices).toHaveLength(1);
    expect(state.devices[0]?.id).toBe("device-1");
    expect(state.deviceActors.has("device-1")).toBe(true);
    expect(actor.getSnapshot().status).toBe("active");
  });

  test("should remove a device and stop its actor", () => {
    const actor = createMockActor();
    const device = makeDevice();

    useDeviceStore.getState().addDevice(device, actor as never);
    useDeviceStore.getState().removeDevice("device-1");

    const state = useDeviceStore.getState();
    expect(state.devices).toHaveLength(0);
    expect(state.deviceActors.has("device-1")).toBe(false);
    expect(actor.getSnapshot().status).toBe("stopped");
  });

  test("should clear selectedDeviceId when removing the selected device", () => {
    const actor = createMockActor();
    const device = makeDevice();

    useDeviceStore.getState().addDevice(device, actor as never);
    useDeviceStore.getState().selectDevice("device-1");
    expect(useDeviceStore.getState().selectedDeviceId).toBe("device-1");

    useDeviceStore.getState().removeDevice("device-1");
    expect(useDeviceStore.getState().selectedDeviceId).toBeNull();
  });

  test("should select a device by id", () => {
    const actor = createMockActor();
    const device = makeDevice();

    useDeviceStore.getState().addDevice(device, actor as never);
    useDeviceStore.getState().selectDevice("device-1");

    expect(useDeviceStore.getState().selectedDeviceId).toBe("device-1");
  });

  test("should return selected device from getSelectedDevice", () => {
    const actor = createMockActor();
    const device = makeDevice();

    useDeviceStore.getState().addDevice(device, actor as never);
    useDeviceStore.getState().selectDevice("device-1");

    const selected = useDeviceStore.getState().getSelectedDevice();
    expect(selected?.id).toBe("device-1");
    expect(selected?.name).toBe("Test TV");
  });

  test("should return null from getSelectedDevice when no device selected", () => {
    expect(useDeviceStore.getState().getSelectedDevice()).toBeNull();
  });
});
