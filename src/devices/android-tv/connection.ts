import { $ } from "bun";

export interface ADBConnection {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendKeyEvent(keyCode: string): Promise<void>;
  pair(port: string, code: string): Promise<void>;
  isConnected(): Promise<boolean>;
}

export function createADBConnection(ip: string): ADBConnection {
  const defaultPort = "5555";

  const runAdb = async (args: string[]): Promise<string> => {
    const result = await $`adb ${args}`.quiet().nothrow();

    if (result.exitCode !== 0) {
      const error = result.stderr.toString() || `ADB command failed`;
      throw new Error(error);
    }

    return result.stdout.toString().trim();
  };

  return {
    async connect() {
      const address = `${ip}:${defaultPort}`;
      const output = await runAdb(["connect", address]);
      if (output.includes("failed to connect") || output.includes("cannot connect")) {
        throw new Error(output);
      }

      // Verify connection is actually working
      try {
        const testResult = await runAdb(["-s", address, "shell", "echo", "ok"]);
        if (!testResult.includes("ok")) {
          throw new Error("Connection verification failed");
        }
      } catch (error) {
        await runAdb(["disconnect", address]).catch(() => {});
        throw new Error(`Connection not responsive: ${error}`);
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
