export interface DriverLifecycleConfig {
  /** Establish the underlying transport connection. */
  connect: (options: { signal?: AbortSignal }) => Promise<void>;
  /** Tear down the underlying transport. Must be safe to call when already closed. */
  disconnect: () => Promise<void> | void;
  /** Runs after a connect that is still the active generation (e.g. subscribe to state). */
  afterConnect?: () => Promise<void> | void;
  /** Runs synchronously before disconnect during close (e.g. drop cached sockets). */
  beforeDisconnect?: () => void;
  /** Extra reason to run close even when the driver was never opened (e.g. a live socket). */
  hasLiveConnection?: () => boolean;
}

export interface DriverLifecycle {
  /** True once a connect succeeded and has not since been closed or reset. */
  isOpen(): boolean;
  /** Drop the open flag without disconnecting (for transport-driven close/error events). */
  markClosed(): void;
  open(options?: { signal?: AbortSignal }): Promise<void>;
  close(): Promise<void> | void;
}

/**
 * Shared open/close bookkeeping for connection-backed drivers: a generation counter
 * so a stale connect that resolves after a newer open/close abandons itself, and a
 * memoized close so repeated close() calls share one disconnect.
 */
export function createDriverLifecycle(config: DriverLifecycleConfig): DriverLifecycle {
  let ready = false;
  let openAttempted = false;
  let generation = 0;
  let closePromise: Promise<void> | undefined;

  return {
    isOpen: () => ready,

    markClosed: () => {
      ready = false;
    },

    async open(options = {}) {
      if (ready) return;

      // Serialize against a close still tearing down the transport: reconnecting
      // while the previous disconnect is in flight races both on one socket.
      if (closePromise) await closePromise.catch(() => undefined);
      closePromise = undefined;

      openAttempted = true;
      const attempt = ++generation;
      try {
        await config.connect(options);
        if (attempt !== generation) {
          await Promise.resolve(config.disconnect()).catch(() => undefined);
          return;
        }
        ready = true;
        await config.afterConnect?.();
      } catch (error) {
        await Promise.resolve(config.disconnect()).catch(() => undefined);
        openAttempted = false;
        throw error;
      }
    },

    close() {
      if (closePromise) return closePromise;
      if (!ready && !openAttempted && !(config.hasLiveConnection?.() ?? false)) return;

      generation += 1;
      ready = false;
      openAttempted = false;
      config.beforeDisconnect?.();
      closePromise = Promise.resolve(config.disconnect()).catch((error) => {
        closePromise = undefined;
        throw error;
      });
      return closePromise;
    },
  };
}
