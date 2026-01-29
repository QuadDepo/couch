import { logger } from "../../utils/logger";

export interface ADBConnection {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendKeyEvent(keyCode: string): Promise<void>;
  sendText(text: string): Promise<void>;
  pair(port: string, code: string): Promise<void>;
  isConnected(): Promise<boolean>;
}

const DEFAULT_PORT = 5555;
const TIMEOUT_MS = 5000;

export function createADBConnection(ip: string): ADBConnection {
  const runAdb = async (args: string[]): Promise<string> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const proc = Bun.spawn(["adb", ...args], {
        signal: controller.signal,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      if (exitCode !== 0) {
        const error = stderr || `ADB command failed`;
        throw new Error(error);
      }

      return stdout.trim();
    } finally {
      clearTimeout(timeout);
    }
  };

  const target = `${ip}:${DEFAULT_PORT}`;

  return {
    async connect() {
      const output = await runAdb(["connect", target]);
      if (output.includes("failed to connect") || output.includes("cannot connect")) {
        throw new Error(output);
      }

      // Always send wakeup key in case device is asleep (harmless if already awake)
      try {
        await runAdb(["-s", target, "shell", "input", "keyevent", "KEYCODE_WAKEUP"]);
        logger.debug("ADB", `Sent wakeup key to ${target}`);
      } catch (error) {
        logger.debug("ADB", `Wakeup key failed (non-critical): ${error}`);
      }

      // Verify connection is actually working
      try {
        const testResult = await runAdb(["-s", target, "shell", "echo", "ok"]);
        if (!testResult.includes("ok")) {
          throw new Error("Connection verification failed");
        }
      } catch (error) {
        await runAdb(["disconnect", target]).catch((disconnectError) => {
          logger.debug("ADB", `Error during cleanup disconnect: ${disconnectError}`);
        });
        throw new Error(`Connection not responsive: ${error}`);
      }
    },

    async disconnect() {
      await runAdb(["disconnect", target]);
    },

    async sendKeyEvent(keyCode: string) {
      const res = await runAdb(["-s", target, "shell", "input", "keyevent", keyCode]);

      logger.debug("ADB", `Sent key event ${keyCode} to ${target}: ${res}`);
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
        await runAdb(["-s", target, "shell", "input", "keyevent", specialChar]);
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

      await runAdb(["-s", target, "shell", "input", "text", escapedText]);
    },

    async pair(port: string, code: string) {
      const output = await runAdb(["pair", `${ip}:${port}`, code]);
      if (output.includes("Failed") || output.includes("failed")) {
        throw new Error(output);
      }
    },

    async isConnected() {
      const output = await runAdb(["-s", target, "shell", "echo", "ok"]);

      return output.trim() === "ok";
    },
  };
}
