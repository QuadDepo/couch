import type { RemoteKey } from "../types";

/**
 * Common events that all device machines should support.
 * These events are used by the useDevice hook to send commands to actors.
 *
 * Device-specific machines can extend this type with additional events:
 * ```typescript
 * type MyDeviceMachineEvent = CommonDeviceEvent | { type: "CUSTOM_EVENT"; ... };
 * ```
 */
export type CommonDeviceEvent =
  // Connection control
  | { type: "CONNECT" }
  | { type: "DISCONNECT" }
  | { type: "CONNECTED" }
  | { type: "CONNECTION_LOST"; error?: string }

  // Remote control
  | { type: "SEND_KEY"; key: RemoteKey }
  | { type: "SEND_TEXT"; text: string }

  // Health monitoring
  | { type: "HEARTBEAT_OK" }
  | { type: "HEARTBEAT_FAILED"; error: string }

  // Credential management
  | { type: "FORGET" }

  // Lifecycle
  | { type: "CANCEL" };
