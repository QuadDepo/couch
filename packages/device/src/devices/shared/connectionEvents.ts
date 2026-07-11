// biome-ignore lint/suspicious/noExplicitAny: Event callbacks have varying argument types per event
type EventCallback = (...args: any[]) => void;

/**
 * Map-of-Sets pub/sub shared by the vendor connection modules. Each vendor
 * passes its own event union so `emit`/`on` stay typed to that platform.
 */
export function createConnectionEvents<TEvent extends string>(events: readonly TEvent[]) {
  const listeners = new Map<TEvent, Set<EventCallback>>(events.map((event) => [event, new Set()]));

  return {
    emit(event: TEvent, ...args: unknown[]) {
      for (const callback of listeners.get(event) ?? []) callback(...args);
    },
    on(event: TEvent, callback: EventCallback) {
      listeners.get(event)?.add(callback);
      return () => listeners.get(event)?.delete(callback);
    },
  };
}
