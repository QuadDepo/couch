import type { DeviceDriver, DriverReceipt } from "../../drivers/types";
import type { DeviceOperation } from "../../operations/types";
import type { RemoteKey } from "../../types";
import { atomicWrite } from "../../utils/atomicWrite";
import { createDriverLifecycle } from "../shared/driverLifecycle";
import {
  type ADBBinaryCommandRunner,
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
  runBinaryCommand?: ADBBinaryCommandRunner;
}

export async function probeAndroidTv(
  config: AndroidTvDriverConfig,
  dependencies: AndroidTvDriverDependencies = {},
  options: ADBCommandOptions = {},
): Promise<ADBReadiness> {
  const adb =
    dependencies.connection ??
    createADBConnection(config.ip, {
      runCommand: dependencies.runCommand,
      runBinaryCommand: dependencies.runBinaryCommand,
    });
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

function optionsFor(signal?: AbortSignal, timeoutMs?: number): ADBCommandOptions {
  return { signal, timeoutMs };
}

export function createAndroidTvDriver(
  config: AndroidTvDriverConfig,
  dependencies: AndroidTvDriverDependencies = {},
): DeviceDriver {
  const adb =
    dependencies.connection ??
    createADBConnection(config.ip, {
      runCommand: dependencies.runCommand,
      runBinaryCommand: dependencies.runBinaryCommand,
    });
  const lifecycle = createDriverLifecycle({
    connect: async (options) => {
      await adb.connect(options);
    },
    disconnect: () => adb.disconnect(),
  });

  return {
    driverId: "adb",
    open: (options) => lifecycle.open(options),
    async execute(
      operation: DeviceOperation,
      options: { signal?: AbortSignal; timeoutMs?: number } = {},
    ): Promise<DriverReceipt> {
      if (!lifecycle.isOpen()) throw new Error("Android TV driver is not open");
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
        case "app.stop":
          await adb.stopApp(operation.appId, commandOptions);
          return { confirmation: "process-exit" };
        case "app.launch":
          if (!operation.activity) {
            throw new Error("Android app.launch requires an explicit activity");
          }
          await adb.launchApp(operation.appId, operation.activity, commandOptions);
          return { confirmation: "process-exit" };
        case "app.foreground": {
          const foregroundAppId = await adb.getForegroundApp(commandOptions);
          return {
            confirmation: "process-exit",
            metadata: {
              expectedAppId: operation.appId,
              foregroundAppId: foregroundAppId ?? "",
              foreground: foregroundAppId === operation.appId,
            },
          };
        }
        case "screen.capture": {
          if (operation.format && operation.format !== "png") {
            throw new Error(`Unsupported Android capture format: ${operation.format}`);
          }
          if (!operation.path) throw new Error("screen.capture requires an output path");
          const bytes = await adb.captureScreen(commandOptions);
          commandOptions.signal?.throwIfAborted();
          await atomicWrite(operation.path, bytes, { signal: commandOptions.signal });
          return {
            confirmation: "process-exit",
            artifacts: [
              {
                path: operation.path,
                type: "screenshot",
                mimeType: "image/png",
                metadata: { byteLength: bytes.byteLength, format: "png" },
              },
            ],
          };
        }
      }
    },
    async isReady() {
      if (!lifecycle.isOpen()) return false;
      return adb.isConnected().catch(() => false);
    },
    close: () => lifecycle.close(),
  };
}
