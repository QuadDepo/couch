// Types

// App constants
export { APP_NAME } from "./constants/app";
// Colors
export {
  ACTIVE_COLOR,
  DIM_COLOR,
  ERROR_COLOR,
  FOCUS_COLOR,
  HIGHLIGHT_COLOR,
  TEXT_DIM,
  TEXT_MUTED,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  WARNING_COLOR,
} from "./constants/colors";

// Actor types
export type { DeviceActor, StoredDeviceActor } from "./devices/actors";
// Common device events
export type { CommonDeviceEvent } from "./devices/commonEvents";
export { capabilities as androidTVCapabilities } from "./devices/android-tv/capabilities";
export type {
  AndroidTVDeviceMachine,
  AndroidTVDeviceMachineActor,
  AndroidTVDeviceMachineSnapshot,
} from "./devices/android-tv/machines/device";
export {
  androidTVDeviceMachine,
  INSTRUCTION_STEPS,
} from "./devices/android-tv/machines/device";
export { capabilities as androidTvRemoteCapabilities } from "./devices/android-tv-remote/capabilities";
export type {
  AndroidTvRemoteDeviceMachine,
  AndroidTvRemoteDeviceMachineActor,
  AndroidTvRemoteDeviceMachineSnapshot,
} from "./devices/android-tv-remote/machines/device";
export { androidTvRemoteDeviceMachine } from "./devices/android-tv-remote/machines/device";
// Device constants
export { calculateRetryDelay, HEARTBEAT_INTERVAL } from "./devices/constants";
// Factory
export {
  implementedPlatforms,
  isPlatformImplemented,
  wrapPlatformCredentials,
} from "./devices/factory";
// Capabilities (renamed to avoid collision)
export { capabilities as webosCapabilities } from "./devices/lg-webos/capabilities";
// Machine types
export type {
  WebOSDeviceMachine,
  WebOSDeviceMachineActor,
} from "./devices/lg-webos/machines/device";
// Machines
export { webosDeviceMachine } from "./devices/lg-webos/machines/device";
export { capabilities as philipsCapabilities } from "./devices/philips-android-tv/capabilities";
export type {
  PhilipsDeviceMachine,
  PhilipsDeviceMachineActor,
} from "./devices/philips-android-tv/machines/device";
export { philipsDeviceMachine } from "./devices/philips-android-tv/machines/device";
export { capabilities as tizenCapabilities } from "./devices/samsung-tizen/capabilities";
export type {
  TizenDeviceMachine,
  TizenDeviceMachineActor,
} from "./devices/samsung-tizen/machines/device";
export { tizenDeviceMachine } from "./devices/samsung-tizen/machines/device";
export type { DeviceSnapshot } from "./devices/selectors";
// Selectors
export { selectConnectionStatus } from "./devices/selectors";
export type {
  CommandResult,
  DeviceCapabilities,
  DeviceFeature,
  KeyMap,
  TextQuickAction,
} from "./devices/types";
// SDK availability check
export { checkSDKAvailability, type SDKAvailability } from "./sdk-check";
export type {
  ConnectionStatus,
  RemoteKey,
  TVDevice,
  TVPlatform,
} from "./types/index";
export { inspector } from "./utils/inspector";
// Utils
export { logger } from "./utils/logger";
export { isValidIp } from "./utils/network";
export { getStatusIndicator, type StatusIndicator } from "./utils/statusIndicator";
export { loadDevices, saveDevices } from "./utils/storage";
