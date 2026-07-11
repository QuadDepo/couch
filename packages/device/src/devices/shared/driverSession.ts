import { type EventObject, fromCallback } from "xstate";
import { deviceLockResourceId } from "../../drivers/lockResourceId";
import type { DeviceDriver } from "../../drivers/types";
import {
  DEFAULT_DEVICE_LOCK_DIRECTORY,
  type DeviceLock,
  type DeviceLockHandle,
} from "../../locks/deviceLock";
import type { RemoteKey } from "../../types";
import { logger } from "../../utils/logger";
import type { DeviceSessionEvent } from "../commonEvents";
import { awaitSessionHandoff, publishSessionHandoff } from "./sessionHandoff";

export const DEFAULT_LOCK_DIRECTORY =
  process.env.COUCH_DEVICE_LOCK_DIR ?? DEFAULT_DEVICE_LOCK_DIRECTORY;

/** Fields every driver-backed session needs to identify and name its device. */
export interface DriverSessionInput {
  ip: string;
  deviceId: string;
  deviceName: string;
}

type DriverOperation = Parameters<DeviceDriver["execute"]>[0];

/** Runs a driver operation in the background; failures surface as CONNECTION_LOST unless opted out. */
type TrackOperation = (operation: DriverOperation, reportOperationError?: boolean) => Promise<void>;

export interface DriverSessionSetup<TInput, TExtraEvent extends EventObject> {
  input: TInput;
  sendBack: (event: DeviceSessionEvent | TExtraEvent) => void;
  reportFailure: (error: unknown) => void;
  /** True once the session has reached CONNECTED (transport close/error events gate on this). */
  isConnected: () => boolean;
}

export interface DriverSessionConfig<
  TInput extends DriverSessionInput,
  TExtraEvent extends EventObject,
> {
  logCategory: string;
  platform: string;
  lockDirectory: string;
  createLock: (directory: string) => DeviceLock;
  createDriver: (setup: DriverSessionSetup<TInput, TExtraEvent>) => DeviceDriver;
  supportsKey: (key: RemoteKey) => boolean;
  heartbeatFailedMessage: string;
  startLog: (input: TInput) => { message: string; details?: Record<string, unknown> };
  /** Fire-and-forget work once CONNECTED, e.g. an initial wake keypress. */
  onConnected?: (track: TrackOperation) => void;
}

/**
 * Session actor for transports that need an exclusive device lock plus a DeviceDriver:
 * acquire the cross-process lock, open the driver, track in-flight operations, and on
 * teardown publish a handoff so the next session waits for this driver to close first.
 * Connection-direct transports (Tizen, Philips, Android TV Remote) skip the lock/driver
 * entirely and stay on their own simpler actors.
 */
export function createDriverSessionActor<
  TInput extends DriverSessionInput,
  TExtraEvent extends EventObject = never,
>(config: DriverSessionConfig<TInput, TExtraEvent>) {
  const { logCategory } = config;

  return fromCallback<DeviceSessionEvent | TExtraEvent, TInput>(({ input, sendBack, receive }) => {
    const start = config.startLog(input);
    logger.info(logCategory, start.message, start.details);

    const resourceId = deviceLockResourceId({
      id: input.deviceId,
      platform: config.platform,
      ip: input.ip,
    });
    const lock = config.createLock(config.lockDirectory);
    const sessionController = new AbortController();
    const operationControllers = new Set<AbortController>();
    const operations = new Set<Promise<void>>();
    let lockHandle: DeviceLockHandle | undefined;
    let connected = false;
    let closed = false;

    const reportFailure = (error: unknown) => {
      if (closed) return;
      connected = false;
      const reason = String(error);
      logger.error(logCategory, `Connection failed: ${reason}`);
      sendBack({ type: "CONNECTION_LOST", error: reason });
    };

    const driver = config.createDriver({
      input,
      sendBack,
      reportFailure,
      isConnected: () => connected,
    });

    const track: TrackOperation = (operation, reportOperationError = true) => {
      const controller = new AbortController();
      operationControllers.add(controller);
      const task = Promise.resolve()
        .then(() => driver.execute(operation, { signal: controller.signal }))
        .then(() => undefined)
        .catch((error) => {
          if (reportOperationError) {
            reportFailure(error);
          } else {
            logger.debug(logCategory, `Operation failed (non-critical): ${String(error)}`);
          }
        })
        .finally(() => {
          operationControllers.delete(controller);
          operations.delete(task);
        });
      operations.add(task);
      return task;
    };

    const closeAndRelease = async () => {
      await Promise.resolve(driver.close()).catch(() => undefined);
      await lockHandle?.release().catch(() => undefined);
      lockHandle = undefined;
    };

    const runConnection = async () => {
      try {
        await awaitSessionHandoff(resourceId);
        if (closed) return;
        lockHandle = await lock.acquire(resourceId, { signal: sessionController.signal });
        if (closed) return closeAndRelease();
        await driver.open({ signal: sessionController.signal });
        if (closed) return closeAndRelease();
        connected = true;
        logger.info(logCategory, `Connected to ${input.deviceName}`);
        sendBack({ type: "CONNECTED" });
        config.onConnected?.(track);
      } catch (error) {
        reportFailure(error);
      }
    };

    receive((rawEvent) => {
      // The machine only sends command events; MUTE_STATE_CHANGED and friends are emit-only.
      const event = rawEvent as DeviceSessionEvent;

      if (event.type === "CHECK_HEARTBEAT") {
        void Promise.resolve(connected && driver.isReady())
          .then((ready) =>
            sendBack(
              ready
                ? { type: "HEARTBEAT_OK" }
                : { type: "HEARTBEAT_FAILED", error: config.heartbeatFailedMessage },
            ),
          )
          .catch((error) => sendBack({ type: "HEARTBEAT_FAILED", error: String(error) }));
        return;
      }

      if (event.type === "SEND_KEY") {
        if (!config.supportsKey(event.key)) {
          logger.warn(logCategory, `Unsupported key: ${event.key}`);
          return;
        }
        if (!connected) {
          logger.warn(logCategory, "Cannot send key: not connected");
          return;
        }
        void track({ kind: "control.press", key: event.key });
        return;
      }

      if (event.type === "SEND_TEXT") {
        if (!connected) {
          logger.warn(logCategory, "Cannot send text: not connected");
          return;
        }
        void track({ kind: "control.text", text: event.text });
      }
    });

    const lifecycle = runConnection();

    return () => {
      if (closed) return;
      closed = true;
      connected = false;
      sessionController.abort(new Error("Session closed"));
      for (const controller of operationControllers) controller.abort(new Error("Session closed"));

      const cleanup = (async () => {
        await Promise.resolve(driver.close()).catch((error) => {
          logger.debug(
            logCategory,
            `Error during disconnect (may already be closed): ${String(error)}`,
          );
        });
        await Promise.allSettled([...operations]);
        await lifecycle.catch(() => undefined);
        await lockHandle?.release().catch(() => undefined);
        lockHandle = undefined;
      })();
      publishSessionHandoff(resourceId, cleanup);
    };
  });
}
