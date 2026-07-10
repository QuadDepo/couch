import type { Observer, StateValue, Subscription } from "xstate";
import type { TVPlatform } from "../types";
import type { DeviceContextBase, DeviceEventBase } from "./shared/machine";

// Shared view of any factory-built device machine, used by the store, hooks,
// and selectors. These are hand-rolled structural types instead of
// `Actor<...>`/`SnapshotFrom<...>`: xstate's machine types are invariant over
// platform context/events (the machine config rides along in the type), so a
// union of the five precise actors overflows the compiler on `.send()`
// (TS2590) and a generically widened machine type rejects platform actors.
// Method-style members keep every platform actor structurally assignable.

/** State-value shape accepted by `snapshot.matches` (mirrors xstate's ToTestStateValue). */
export type DeviceStateTestValue =
  | string
  | number
  | { [key: string]: DeviceStateTestValue | undefined };

/** Type-erased snapshot of a factory-built device machine: base context, platform extras widened. */
export interface DeviceSnapshot {
  context: DeviceContextBase & { credentials?: object };
  value: StateValue;
  status: "active" | "done" | "error" | "stopped";
  error: unknown;
  matches(stateValue: DeviceStateTestValue): boolean;
}

/** Type-erased actor for a factory-built device machine; accepts the shared events only. */
export interface DeviceActor {
  id: string;
  sessionId: string;
  send(event: DeviceEventBase): void;
  getSnapshot(): DeviceSnapshot;
  start(): void;
  stop(): void;
  subscribe(observer: Observer<DeviceSnapshot>): Subscription;
  subscribe(
    next: (snapshot: DeviceSnapshot) => void,
    error?: (error: unknown) => void,
    complete?: () => void,
  ): Subscription;
}

export interface StoredDeviceActor {
  platform: TVPlatform;
  actor: DeviceActor;
}
