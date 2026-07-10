import { fromCallback } from "xstate";
import { deviceLockResourceId } from "../../../../drivers/lockResourceId";
import type { DeviceDriver } from "../../../../drivers/types";
import {
  createDeviceLock,
  DEFAULT_DEVICE_LOCK_DIRECTORY,
  type DeviceLock,
  type DeviceLockHandle,
} from "../../../../locks/deviceLock";
import type { RemoteKey } from "../../../../types";
import { logger } from "../../../../utils/logger";
import { awaitSessionHandoff, publishSessionHandoff } from "../../../shared/sessionHandoff";
import { type AndroidTvDriverConfig, createAndroidTvDriver } from "../../driver";
import { keymap } from "../../keymap";

export interface SessionInput {
  ip: string;
  deviceName: string;
  deviceId: string;
}

export type SessionEvent =
  | { type: "CONNECTED" }
  | { type: "CONNECTION_LOST"; error?: string }
  | { type: "HEARTBEAT_OK" }
  | { type: "HEARTBEAT_FAILED"; error: string }
  | { type: "SEND_KEY"; key: RemoteKey }
  | { type: "SEND_TEXT"; text: string }
  | { type: "CHECK_HEARTBEAT" };

export interface AndroidTvSessionDependencies {
  createDriver?: (config: AndroidTvDriverConfig) => DeviceDriver;
  createLock?: (directory: string) => DeviceLock;
  lockDirectory?: string;
}

const defaultLockDirectory = process.env.COUCH_DEVICE_LOCK_DIR ?? DEFAULT_DEVICE_LOCK_DIRECTORY;

export function createAndroidTvSessionActor(dependencies: AndroidTvSessionDependencies = {}) {
  const makeDriver = dependencies.createDriver ?? ((config) => createAndroidTvDriver(config));
  const makeLock = dependencies.createLock ?? ((directory) => createDeviceLock(directory));
  const lockDirectory = dependencies.lockDirectory ?? defaultLockDirectory;

  return fromCallback<SessionEvent, SessionInput>(({ input, sendBack, receive }) => {
    logger.info("ADB", `Starting session connection to ${input.deviceName}`, { ip: input.ip });

    const resourceId = deviceLockResourceId({
      id: input.deviceId,
      platform: "android-tv",
      ip: input.ip,
    });
    const driver = makeDriver({ ip: input.ip });
    const lock = makeLock(lockDirectory);
    const sessionController = new AbortController();
    const operationControllers = new Set<AbortController>();
    const operations = new Set<Promise<void>>();
    let lockHandle: DeviceLockHandle | undefined;
    let connected = false;
    let closed = false;

    const reportFailure = (error: unknown) => {
      if (closed) return;
      connected = false;
      sendBack({ type: "CONNECTION_LOST", error: String(error) });
    };

    const track = (
      operation: Parameters<DeviceDriver["execute"]>[0],
      reportOperationError = true,
    ) => {
      const controller = new AbortController();
      operationControllers.add(controller);
      const task = Promise.resolve()
        .then(() => driver.execute(operation, { signal: controller.signal }))
        .then(() => undefined)
        .catch((error) => {
          if (!reportOperationError) {
            logger.debug("ADB", `Wake operation failed (non-critical): ${error}`);
          } else if (!closed) {
            reportFailure(error);
          }
        })
        .finally(() => {
          operationControllers.delete(controller);
          operations.delete(task);
        });
      operations.add(task);
      return task;
    };

    const runConnection = async () => {
      try {
        await awaitSessionHandoff(resourceId);
        if (closed) return;
        lockHandle = await lock.acquire(resourceId, { signal: sessionController.signal });
        if (closed) {
          await Promise.resolve(driver.close()).catch(() => undefined);
          await lockHandle.release().catch(() => undefined);
          lockHandle = undefined;
          return;
        }
        await driver.open({ signal: sessionController.signal });
        if (closed) {
          await Promise.resolve(driver.close()).catch(() => undefined);
          await lockHandle?.release().catch(() => undefined);
          lockHandle = undefined;
          return;
        }
        connected = true;
        logger.info("ADB", `Connected to ${input.deviceName}`);
        sendBack({ type: "CONNECTED" });
        void track({ kind: "device.wake" }, false);
      } catch (error) {
        if (!closed) {
          logger.error("ADB", `Connection failed: ${error}`);
          reportFailure(error);
        }
      }
    };

    receive((event) => {
      if (event.type === "CHECK_HEARTBEAT") {
        void Promise.resolve(connected && driver.isReady())
          .then((ready) =>
            sendBack(
              ready
                ? { type: "HEARTBEAT_OK" }
                : { type: "HEARTBEAT_FAILED", error: "Not connected" },
            ),
          )
          .catch((error) => sendBack({ type: "HEARTBEAT_FAILED", error: String(error) }));
        return;
      }

      if (event.type === "SEND_KEY") {
        if (!keymap[event.key]) {
          logger.warn("ADB", `Unsupported key: ${event.key}`);
          return;
        }
        if (!connected) {
          logger.warn("ADB", "Cannot send key: not connected");
          return;
        }
        void track({ kind: "control.press", key: event.key });
        return;
      }

      if (event.type === "SEND_TEXT") {
        if (!connected) {
          logger.warn("ADB", "Cannot send text: not connected");
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
          logger.debug("ADB", `Error during disconnect (may already be closed): ${error}`);
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

export const sessionActor = createAndroidTvSessionActor();
