import { fromCallback } from "xstate";
import {
  canonicalLockResourceId,
  createDeviceLock,
  DEFAULT_DEVICE_LOCK_DIRECTORY,
  type DeviceLock,
  type DeviceLockHandle,
} from "../../../../runtime/deviceLock";
import type { DeviceDriver } from "../../../../runtime/types";
import type { RemoteKey } from "../../../../types";
import { logger } from "../../../../utils/logger";
import { awaitSessionHandoff, publishSessionHandoff } from "../../../shared/sessionHandoff";
import { createWebOSConnection } from "../../connection";
import type { WebOSCredentials } from "../../credentials";
import { createLgWebosDriver, type LgWebosDriverConfig } from "../../driver";
import { keymap } from "../../keymap";

export interface SessionInput {
  ip: string;
  credentials: WebOSCredentials;
  deviceName: string;
  deviceId: string;
  useSsl?: boolean;
}

export type SessionEvent =
  | { type: "CONNECTED" }
  | { type: "CONNECTION_LOST"; error?: string }
  | { type: "HEARTBEAT_OK" }
  | { type: "HEARTBEAT_FAILED"; error: string }
  | { type: "MUTE_STATE_CHANGED"; mute: boolean }
  | { type: "SEND_KEY"; key: RemoteKey }
  | { type: "SEND_TEXT"; text: string }
  | { type: "CHECK_HEARTBEAT" };

export interface LgWebosSessionDependencies {
  createDriver?: (
    config: LgWebosDriverConfig,
    dependencies: {
      connection: ReturnType<typeof createWebOSConnection>;
      onMuteStateChanged: (mute: boolean) => void;
    },
  ) => DeviceDriver;
  createLock?: (directory: string) => DeviceLock;
  createConnection?: (config: {
    ip: string;
    mac: string;
    clientKey?: string;
    timeout: number;
    reconnect: number;
    useSsl: boolean;
  }) => ReturnType<typeof createWebOSConnection>;
  lockDirectory?: string;
}

const defaultLockDirectory = process.env.COUCH_DEVICE_LOCK_DIR ?? DEFAULT_DEVICE_LOCK_DIRECTORY;

export function createLgWebosSessionActor(dependencies: LgWebosSessionDependencies = {}) {
  const makeLock = dependencies.createLock ?? ((directory) => createDeviceLock(directory));
  const makeConnection = dependencies.createConnection ?? createWebOSConnection;
  const makeDriver =
    dependencies.createDriver ??
    ((config, driverDependencies) => createLgWebosDriver(config, driverDependencies));
  const lockDirectory = dependencies.lockDirectory ?? defaultLockDirectory;

  return fromCallback<SessionEvent, SessionInput>(({ input, sendBack, receive }) => {
    const useSsl = input.useSsl ?? input.credentials.useSsl ?? false;
    logger.info("WebOS", `Starting session connection to ${input.deviceName} (SSL: ${useSsl})`, {
      ip: input.ip,
    });

    const resourceId = canonicalLockResourceId({
      id: input.deviceId,
      platform: "lg-webos",
      ip: input.ip,
    });
    const connection = makeConnection({
      ip: input.ip,
      mac: input.credentials.mac ?? "",
      clientKey: input.credentials.clientKey,
      timeout: 15000,
      reconnect: 0,
      useSsl,
    });
    const driver = makeDriver(
      { ip: input.ip, credentials: input.credentials, useSsl },
      { connection, onMuteStateChanged: (mute) => sendBack({ type: "MUTE_STATE_CHANGED", mute }) },
    );
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

    connection.on("close", () => {
      if (connected) reportFailure("Connection closed");
    });
    connection.on("error", (error) => {
      reportFailure(error);
    });

    const track = (operation: Parameters<DeviceDriver["execute"]>[0]) => {
      const controller = new AbortController();
      operationControllers.add(controller);
      const task = Promise.resolve()
        .then(() => driver.execute(operation, { signal: controller.signal }))
        .then(() => undefined)
        .catch((error) => {
          if (!closed) reportFailure(error);
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
        logger.info("WebOS", `Connected to ${input.deviceName}`);
        sendBack({ type: "CONNECTED" });
      } catch (error) {
        if (!closed) {
          logger.error("WebOS", `Connection failed: ${error}`);
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
                : { type: "HEARTBEAT_FAILED", error: "Connection lost" },
            ),
          )
          .catch((error) => sendBack({ type: "HEARTBEAT_FAILED", error: String(error) }));
        return;
      }

      if (event.type === "SEND_KEY") {
        if (!keymap[event.key]) {
          logger.warn("WebOS", `Unsupported key: ${event.key}`);
          return;
        }
        if (!connected) {
          logger.warn("WebOS", "Cannot send key: not connected");
          return;
        }
        void track({ kind: "control.press", key: event.key });
        return;
      }

      if (event.type === "SEND_TEXT") {
        if (!connected) {
          logger.warn("WebOS", "Cannot send text: not connected");
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
          logger.debug("WebOS", `Error during disconnect (may already be closed): ${error}`);
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

export const sessionActor = createLgWebosSessionActor();
