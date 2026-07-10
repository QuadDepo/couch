import type { ConnectionEvent } from "./connectionTypes";

export function createConnectionEvents() {
  // biome-ignore lint/suspicious/noExplicitAny: Event callbacks have varying argument types per event
  const listeners: Map<ConnectionEvent, Set<(...args: any[]) => void>> = new Map([
    ["connect", new Set()],
    ["close", new Set()],
    ["error", new Set()],
    ["prompt", new Set()],
    ["message", new Set()],
  ]);

  return {
    emit(event: ConnectionEvent, ...args: unknown[]) {
      for (const callback of listeners.get(event) ?? []) callback(...args);
    },
    // biome-ignore lint/suspicious/noExplicitAny: Event callbacks have varying argument types per event
    on(event: ConnectionEvent, callback: (...args: any[]) => void) {
      listeners.get(event)?.add(callback);
      return () => listeners.get(event)?.delete(callback);
    },
  };
}
