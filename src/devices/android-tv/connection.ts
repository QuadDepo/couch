import { $ } from "bun";
import { logger } from "../../utils/logger";

export interface ADBConnection {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendKeyEvent(keyCode: string): Promise<void>;
  pair(port: string, code: string): Promise<void>;
  isConnected(): Promise<boolean>;
}

const CONNECT_TIMEOUT_MS = 5000;

export function createADBConnection(ip: string): ADBConnection {
  const defaultPort = "5555";

  const runAdb = async (args: string[], timeoutMs?: number): Promise<string> => {
    const cmd = `adb ${args.join(" ")}`;
    logger.info("adb", `Executing: ${cmd}${timeoutMs ? ` (timeout: ${timeoutMs}ms)` : ""}`);
    const start = Date.now();

    const proc = $`adb ${args}`.quiet().nothrow();
    const result = timeoutMs
      ? await Promise.race([
          proc,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
          ),
        ])
      : await proc;

    const duration = Date.now() - start;

    if (result.exitCode !== 0) {
      const error = result.stderr.toString() || `ADB command failed: ${cmd}`;
      logger.error("adb", `Failed (${duration}ms): ${error}`);
      throw new Error(error);
    }

    const output = result.stdout.toString().trim();
    logger.info("adb", `Success (${duration}ms): ${output || "(no output)"}`);
    return output;
  };

  return {
    async connect() {
      const output = await runAdb(["connect", `${ip}:${defaultPort}`], CONNECT_TIMEOUT_MS);
      if (output.includes("failed to connect") || output.includes("cannot connect")) {
        throw new Error(output);
      }
    },

    async disconnect() {
      await runAdb(["disconnect", `${ip}:${defaultPort}`]);
    },

    async sendKeyEvent(keyCode: string) {
      await runAdb(["-s", `${ip}:${defaultPort}`, "shell", "input", "keyevent", keyCode]);
    },

    async pair(port: string, code: string) {
      const output = await runAdb(["pair", `${ip}:${port}`, code]);
      if (output.includes("Failed") || output.includes("failed")) {
        throw new Error(output);
      }
    },

    async isConnected() {
      const output = await runAdb(["devices"]);
      return output.includes(`${ip}:${defaultPort}`);
    },
  };
}
