import type { DeviceInventory, DeviceInventoryOptions } from "@couch/device";
import type { CouchTestConfig } from "@couch/runner/config";
import { parseForeground, runForeground } from "./app/foreground";
import { humanApp, parseLaunch, runLaunch } from "./app/launch";
import type { ParsedAppCommand } from "./app/types";
import { writeResult } from "./commandOutput";
import { humanDoctor, parseDoctor, runDoctor } from "./device/doctor";
import { humanList, parseList, runList } from "./device/list";
import type { ParsedDoctor, ParsedList } from "./device/types";
import { USAGE_EXIT, UsageError } from "./errors";
import { type CliSignalTarget, installSignalControl } from "./processSignals";
import { humanPress, parsePress, runPress } from "./remote/press";
import type { ParsedPress } from "./remote/types";
import { humanScreenshot, parseScreenshot, runScreenshot } from "./screenshot/capture";
import type { ParsedScreenshot } from "./screenshot/types";
import { humanTest, parseTest, runTest } from "./test/run";
import type { ParsedTest } from "./test/types";

const HELP = `Usage:
  couch device list [--json]
  couch device doctor <target> [--json]
  couch remote press <target> <KEY> [--times N] [--json]
  couch app launch <target> [--json]
  couch app foreground <target> [--json]
  couch screenshot <target> --out <path> [--json]
  couch test <file> --target <alias> [--json]

Options:
  --times N  Send the key N times (default: 1)
  --json     Emit one JSON result on stdout
  -h, --help Show this help
`;

type ParsedCommand =
  | ParsedList
  | ParsedDoctor
  | ParsedPress
  | ParsedAppCommand
  | ParsedScreenshot
  | ParsedTest;

export interface CliDependencies {
  createInventory?: (
    options?: DeviceInventoryOptions,
  ) => DeviceInventory | Promise<DeviceInventory>;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  signalTarget?: CliSignalTarget;
  loadConfig?: () => Promise<CouchTestConfig>;
  runTvTest?: typeof import("@couch/runner/runner").runTvTest;
}

function parseCommand(args: readonly string[]): ParsedCommand {
  if (args[0] === "device" && args[1] === "list") return parseList(args.slice(2));
  if (args[0] === "device" && args[1] === "doctor") return parseDoctor(args.slice(2));
  if (args[0] === "remote" && args[1] === "press") return parsePress(args.slice(2));
  if (args[0] === "app" && args[1] === "launch") return parseLaunch(args.slice(2));
  if (args[0] === "app" && args[1] === "foreground") return parseForeground(args.slice(2));
  if (args[0] === "screenshot") return parseScreenshot(args.slice(1));
  if (args[0] === "test") return parseTest(args.slice(1));
  throw new UsageError("expected device, remote, app, screenshot, or test command");
}

async function defaultCreateInventory(
  options: DeviceInventoryOptions = {},
): Promise<DeviceInventory> {
  const { createDeviceInventory } = await import("@couch/device");
  return createDeviceInventory(options);
}

export async function runCli(
  args: readonly string[],
  dependencies: CliDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = dependencies.stderr ?? ((text: string) => process.stderr.write(text));
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    stdout(HELP);
    return 0;
  }

  let command: ParsedCommand;
  try {
    command = parseCommand(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(`usage: ${message}\n\n${HELP}`);
    return USAGE_EXIT;
  }

  const createInventory = dependencies.createInventory ?? defaultCreateInventory;
  const diagnostics: string[] = [];
  let inventoryPromise: Promise<DeviceInventory> | undefined;
  const getInventory = () => {
    inventoryPromise ??= Promise.resolve(
      createInventory({
        diagnosticSink: (event) => {
          const line = `${event.level}: ${event.message}`;
          diagnostics.push(line);
          stderr(`${line}\n`);
        },
      }),
    );
    return inventoryPromise;
  };
  const signals = installSignalControl(dependencies.signalTarget ?? process);

  try {
    switch (command.command) {
      case "device.list": {
        const result = await runList(getInventory, signals);
        writeResult(result, command.json, humanList(result), stdout, stderr);
        return result.exitCode;
      }
      case "device.doctor": {
        const result = await runDoctor(command, getInventory, signals);
        writeResult(result, command.json, humanDoctor(result), stdout, stderr);
        return result.exitCode;
      }
      case "remote.press": {
        const result = await runPress(command, getInventory, signals);
        writeResult(result, command.json, humanPress(result), stdout, stderr);
        return result.exitCode;
      }
      case "app.launch": {
        const result = await runLaunch(command, getInventory, signals, dependencies.loadConfig);
        writeResult(result, command.json, humanApp(result), stdout, stderr);
        return result.exitCode;
      }
      case "app.foreground": {
        const result = await runForeground(command, getInventory, signals, dependencies.loadConfig);
        writeResult(result, command.json, humanApp(result), stdout, stderr);
        return result.exitCode;
      }
      case "screenshot": {
        const result = await runScreenshot(command, getInventory, signals, dependencies.loadConfig);
        writeResult(result, command.json, humanScreenshot(result), stdout, stderr);
        return result.exitCode;
      }
      case "test": {
        const result = await runTest(
          command,
          getInventory,
          signals,
          diagnostics,
          dependencies.runTvTest,
        );
        writeResult(result, command.json, humanTest(result), stdout, stderr);
        return result.exitCode;
      }
    }
  } finally {
    signals.dispose();
  }
}
