// Types

// App constants
export { APP_NAME } from "./constants/app";
// Actor types
export type { DeviceActor, DeviceSnapshot, StoredDeviceActor } from "./devices/actors";
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
// Common device events
export type { CommonDeviceEvent } from "./devices/commonEvents";
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
export { capabilities as philipsCapabilities } from "./devices/philips-tv/capabilities";
export type {
  PhilipsDeviceMachine,
  PhilipsDeviceMachineActor,
} from "./devices/philips-tv/machines/device";
export { philipsDeviceMachine } from "./devices/philips-tv/machines/device";
// Platform registry
export type { ImplementedPlatform, PlatformRegistration } from "./devices/registry";
export { platformRegistry } from "./devices/registry";
export { capabilities as tizenCapabilities } from "./devices/samsung-tizen/capabilities";
export type {
  TizenDeviceMachine,
  TizenDeviceMachineActor,
} from "./devices/samsung-tizen/machines/device";
export { tizenDeviceMachine } from "./devices/samsung-tizen/machines/device";
// Selectors
export { selectConnectionStatus } from "./devices/selectors";
export type {
  DeviceCapabilities,
  DeviceFeature,
  KeyMap,
  TextQuickAction,
} from "./devices/types";
export type { DiagnosticEvent, DiagnosticSink } from "./diagnostics/events";
// Device inventory and sessions
export { createDeviceInventory } from "./inventory/deviceInventory";
export type {
  InventoryErrorCode,
  StorageSchema,
} from "./inventory/inventorySchema";
export { InventoryError, loadDevices, saveDevices } from "./inventory/loadInventory";
export type {
  DeviceDescriptor,
  DeviceInventory,
  DeviceInventoryErrorCode,
  DeviceInventoryOptions,
  InventoryLoader,
  OpenSessionOptions,
  PersistedDevice,
  QueryOptions,
} from "./inventory/types";
export { DeviceInventoryError } from "./inventory/types";
export type {
  ArtifactReference,
  Confirmation,
  DeviceOperation,
  DriverId,
  OperationCapability,
  OperationError,
  OperationKind,
  OperationRecord,
  OperationStatus,
  ProductPlatform,
  Readiness,
  Support,
} from "./operations/types";
export { isOperationKind } from "./operations/types";
// SDK availability check
export { checkSDKAvailability, type SDKAvailability } from "./sdk-check";
export type { DeviceSession, ExecuteOptions } from "./sessions/deviceSession";
export { DeviceSessionError } from "./sessions/deviceSession";
export type {
  ConnectionStatus,
  RemoteKey,
  TVDevice,
  TVPlatform,
} from "./types/index";
export { isRemoteKey, REMOTE_KEYS } from "./types/index";
// Utils
export { atomicWrite } from "./utils/atomicWrite";
export { logger } from "./utils/logger";
export { isValidIp } from "./utils/network";
