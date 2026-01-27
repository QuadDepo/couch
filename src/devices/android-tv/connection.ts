import { $ } from "bun";
import { logger } from "../../utils/logger";

export interface ADBConnection {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendKeyEvent(keyCode: string): Promise<void>;
  sendText(text: string): Promise<void>;
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
        await runAdb(["disconnect", address]).catch((disconnectError) => {
          logger.debug("ADB", `Error during cleanup disconnect: ${disconnectError}`);
        });
        throw new Error(`Connection not responsive: ${error}`);
      }
    },

    async disconnect() {
      await runAdb(["disconnect", `${ip}:${defaultPort}`]);
    },

    async sendKeyEvent(keyCode: string) {
      await runAdb(["-s", `${ip}:${defaultPort}`, "shell", "input", "keyevent", keyCode]);
    },

    async sendText(text: string) {
      // Handle special characters that should be sent as key events
      const specialChars: Record<string, string> = {
        "\b": "KEYCODE_DEL", // backspace
        "\n": "KEYCODE_ENTER", // enter/newline
        "\t": "KEYCODE_TAB", // tab
        "\x1b": "KEYCODE_BACK", // escape
      };

      // Check if text is a single special character
      const specialChar = text.length === 1 ? specialChars[text] : undefined;
      if (specialChar) {
        await runAdb(["-s", `${ip}:${defaultPort}`, "shell", "input", "keyevent", specialChar]);
        return;
      }

      // Escape text for shell - replace spaces with %s and other special chars
      // Also escape other shell special characters
      const escapedText = text
        .replace(/ /g, "%s")
        .replace(/&/g, "\\&")
        .replace(/</g, "<")
        .replace(/>/g, ">")
        .replace(/\$/g, "\\$")
        .replace(/"/g, '\\"')
        .replace(/'/g, "\\'")
        .replace(/\(/g, "\\(")
        .replace(/\)/g, "\\)")
        .replace(/;/g, "\\;")
        .replace(/\|/g, "\\|");

      await runAdb(["-s", `${ip}:${defaultPort}`, "shell", "input", "text", escapedText]);
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
