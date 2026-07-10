import type { DeviceDriver, DriverReceipt } from "../../drivers/types";
import type { DeviceOperation } from "../../operations/types";
import type { RemoteKey } from "../../types";
import {
  type ADBCommandOptions,
  type ADBCommandRunner,
  type ADBConnection,
  type ADBReadiness,
  classifyAdbReadiness,
  createADBConnection,
} from "./connection";
import { keymap } from "./keymap";

export interface AndroidTvDriverConfig {
  ip: string;
}

export interface AndroidTvDriverDependencies {
  connection?: ADBConnection;
  runCommand?: ADBCommandRunner;
}

export async function probeAndroidTv(
  config: AndroidTvDriverConfig,
  dependencies: AndroidTvDriverDependencies = {},
  options: ADBCommandOptions = {},
): Promise<ADBReadiness> {
  const adb =
    dependencies.connection ??
    createADBConnection(config.ip, { runCommand: dependencies.runCommand });
  if (adb.getReadiness) {
    try {
      return await adb.getReadiness(options);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      return classifyAdbReadiness(error);
    }
  }
  try {
    await adb.connect(options);
    return (await adb.isConnected(options)) ? "ready" : "offline";
  } catch (error) {
    return classifyAdbReadiness(error);
  }
}

function unsupported(kind: string): Error {
  return new Error(`Unsupported Android TV operation: ${kind}`);
}

function optionsFor(signal?: AbortSignal, timeoutMs?: number): ADBCommandOptions {
  return { signal, timeoutMs };
}

export function createAndroidTvDriver(
  config: AndroidTvDriverConfig,
  dependencies: AndroidTvDriverDependencies = {},
): DeviceDriver {
  const adb =
    dependencies.connection ??
    createADBConnection(config.ip, { runCommand: dependencies.runCommand });
  let ready = false;
  let openAttempted = false;
  let generation = 0;
  let closePromise: Promise<void> | undefined;

  return {
    adapterId: "adb",
    async open(options = {}) {
      if (ready) return;
      closePromise = undefined;
      openAttempted = true;
      const attempt = ++generation;
      try {
        await adb.connect(options);
        if (attempt !== generation) {
          await Promise.resolve(adb.disconnect()).catch(() => undefined);
          return;
        }
        ready = true;
      } catch (error) {
        await Promise.resolve(adb.disconnect()).catch(() => undefined);
        openAttempted = false;
        throw error;
      }
    },
    async execute(
      operation: DeviceOperation,
      options: { signal?: AbortSignal; timeoutMs?: number } = {},
    ): Promise<DriverReceipt> {
      if (!ready) throw new Error("Android TV driver is not open");
      const commandOptions = optionsFor(options.signal, options.timeoutMs);

      switch (operation.kind) {
        case "control.press": {
          const keyCode = keymap[operation.key as RemoteKey];
          if (!keyCode) throw new Error(`Unsupported Android TV key: ${operation.key}`);
          await adb.sendKeyEvent(String(keyCode), commandOptions);
          return { confirmation: "process-exit" };
        }
        case "control.text":
          await adb.sendText(operation.text, commandOptions);
          return { confirmation: "process-exit" };
        case "device.wake":
          await adb.sendKeyEvent("KEYCODE_WAKEUP", commandOptions);
          return { confirmation: "process-exit" };
        default:
          throw unsupported(operation.kind);
      }
    },
    async isReady() {
      if (!ready) return false;
      return adb.isConnected().catch(() => false);
    },
    async close() {
      if (closePromise) return closePromise;
      if (!ready && !openAttempted) return;
      generation += 1;
      ready = false;
      openAttempted = false;
      closePromise = adb.disconnect().catch((error) => {
        closePromise = undefined;
        throw error;
      });
      return closePromise;
    },
  };
}
