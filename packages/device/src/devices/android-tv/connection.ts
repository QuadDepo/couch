import { logger } from "../../utils/logger";

export interface ADBConnection {
  connect(options?: ADBCommandOptions): Promise<void>;
  disconnect(options?: ADBCommandOptions): Promise<void>;
  sendKeyEvent(keyCode: string, options?: ADBCommandOptions): Promise<void>;
  sendText(text: string, options?: ADBCommandOptions): Promise<void>;
  pair(port: string, code: string, options?: ADBCommandOptions): Promise<void>;
  isConnected(options?: ADBCommandOptions): Promise<boolean>;
  getReadiness?(options?: ADBCommandOptions): Promise<ADBReadiness>;
  stopApp(appId: string, options?: ADBCommandOptions): Promise<void>;
  launchApp(appId: string, activity: string, options?: ADBCommandOptions): Promise<void>;
  getForegroundApp(options?: ADBCommandOptions): Promise<string | undefined>;
  captureScreen(options?: ADBCommandOptions): Promise<Uint8Array>;
}

export interface ADBCommandOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type ADBReadiness = "ready" | "missing-tool" | "unauthorized" | "offline";

export type ADBCommandRunner = (args: string[], options?: ADBCommandOptions) => Promise<string>;
export type ADBBinaryCommandRunner = (
  args: string[],
  options?: ADBCommandOptions,
) => Promise<Uint8Array>;

export interface ADBConnectionDependencies {
  runCommand?: ADBCommandRunner;
  runBinaryCommand?: ADBBinaryCommandRunner;
}

const DEFAULT_PORT = 5555;
const TIMEOUT_MS = 5000;

export function classifyAdbReadiness(error: unknown): ADBReadiness {
  const value =
    typeof error === "object" && error !== null
      ? (error as { code?: string; message?: string })
      : {};
  const text = `${value.code ?? ""} ${value.message ?? error}`.toLowerCase();
  const failedToLaunchAdb =
    /\b(?:failed|unable) to (?:spawn|launch|start|execute|run)\b.*\badb(?:\.exe)?\b/.test(text) ||
    /\b(?:spawn|launch|start|execute|run)\s+(?:process\s+)?["']?adb(?:\.exe)?\b/.test(text) ||
    /\b(?:could not|cannot|unable to) find\s+(?:the\s+)?["']?adb(?:\.exe)?\b/.test(text) ||
    /\bexec:\s*["']?adb(?:\.exe)?["']?.*\bexecutable file not found\b/.test(text);
  if (text.includes("unauthorized") || text.includes("authentication")) return "unauthorized";
  if (value.code === "ENOENT") return "missing-tool";
  if (/\b(?:device|serial)\b.*\bnot found\b/.test(text)) return "offline";
  if (failedToLaunchAdb) return "missing-tool";
  return "offline";
}

export function createADBConnection(
  ip: string,
  dependencies: ADBConnectionDependencies = {},
): ADBConnection {
  async function spawnAdb(
    args: string[],
    options: ADBCommandOptions,
  ): Promise<{ stdout: Uint8Array; stderr: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("ADB command timeout")),
      options.timeoutMs ?? TIMEOUT_MS,
    );
    const abort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    try {
      const proc = Bun.spawn(["adb", ...args], {
        signal: controller.signal,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).bytes(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (exitCode !== 0) throw new Error(stderr || "ADB command failed");
      return { stdout, stderr };
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    }
  }

  const runAdb: ADBCommandRunner =
    dependencies.runCommand ??
    (async (args, options = {}) =>
      new TextDecoder().decode((await spawnAdb(args, options)).stdout).trim());
  const runBinaryAdb: ADBBinaryCommandRunner =
    dependencies.runBinaryCommand ??
    (async (args, options = {}) => (await spawnAdb(args, options)).stdout);

  const target = `${ip}:${DEFAULT_PORT}`;

  return {
    async connect(options) {
      const output = await runAdb(["connect", target], options);
      if (output.includes("failed to connect") || output.includes("cannot connect")) {
        throw new Error(output);
      }

      try {
        const testResult = await runAdb(["-s", target, "shell", "echo", "ok"], options);
        if (!testResult.includes("ok")) {
          throw new Error("Connection verification failed");
        }
      } catch (error) {
        await runAdb(["disconnect", target], { timeoutMs: options?.timeoutMs }).catch(
          (disconnectError) => {
            logger.debug("ADB", `Error during cleanup disconnect: ${disconnectError}`);
          },
        );
        throw new Error(`Connection not responsive: ${error}`);
      }
    },

    async disconnect(options) {
      await runAdb(["disconnect", target], options);
    },

    async sendKeyEvent(keyCode: string, options) {
      const res = await runAdb(["-s", target, "shell", "input", "keyevent", keyCode], options);

      logger.debug("ADB", `Sent key event ${keyCode} to ${target}: ${res}`);
    },

    async sendText(text: string, options) {
      const specialChars: Record<string, string> = {
        "\b": "KEYCODE_DEL", // backspace
        "\n": "KEYCODE_ENTER", // enter/newline
        "\t": "KEYCODE_TAB", // tab
        "\x1b": "KEYCODE_BACK", // escape
      };

      const specialChar = text.length === 1 ? specialChars[text] : undefined;
      if (specialChar) {
        await runAdb(["-s", target, "shell", "input", "keyevent", specialChar], options);
        return;
      }

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

      await runAdb(["-s", target, "shell", "input", "text", escapedText], options);
    },

    async pair(port: string, code: string, options) {
      const output = await runAdb(["pair", `${ip}:${port}`, code], options);
      if (output.includes("Failed") || output.includes("failed")) {
        throw new Error(output);
      }
    },

    async isConnected(options) {
      const output = await runAdb(["-s", target, "shell", "echo", "ok"], options);

      return output.trim() === "ok";
    },
    async getReadiness(options) {
      try {
        const output = await runAdb(["connect", target], options);
        const connectionText = output.toLowerCase();
        if (connectionText.includes("unauthorized")) return "unauthorized";
        if (
          connectionText.includes("failed to connect") ||
          connectionText.includes("cannot connect") ||
          connectionText.includes("offline")
        )
          return "offline";
        const shell = await runAdb(["-s", target, "shell", "echo", "ok"], options);
        const shellText = shell.toLowerCase();
        if (shellText.includes("unauthorized")) return "unauthorized";
        if (shellText.includes("offline")) return "offline";
        return shell.trim() === "ok" ? "ready" : "offline";
      } catch (error) {
        if (options?.signal?.aborted) throw error;
        return classifyAdbReadiness(error);
      }
    },
    async stopApp(appId, options) {
      await runAdb(["-s", target, "shell", "am", "force-stop", appId], options);
    },
    async launchApp(appId, activity, options) {
      await runAdb(["-s", target, "shell", "am", "start", "-n", `${appId}/${activity}`], options);
    },
    async getForegroundApp(options) {
      const output = await runAdb(
        ["-s", target, "shell", "dumpsys", "activity", "activities"],
        options,
      );
      return [
        /mResumedActivity[^\n]*\s([\w.]+)\//,
        /mCurrentFocus[^\n]*\s([\w.]+)\//,
        /mFocusedApp[^\n]*\s([\w.]+)\//,
      ]
        .map((pattern) => output.match(pattern)?.[1])
        .find(Boolean);
    },
    captureScreen(options) {
      return runBinaryAdb(["-s", target, "exec-out", "screencap", "-p"], options);
    },
  };
}
