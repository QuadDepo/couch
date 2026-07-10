import type { DeviceInventory, DeviceInventoryOptions } from "@couch/device";
import { writeResult } from "./commandOutput";
import { humanDoctor, parseDoctor, runDoctor } from "./device/doctor";
import { humanList, parseList, runList } from "./device/list";
import type { ParsedDoctor, ParsedList } from "./device/types";
import { USAGE_EXIT, UsageError } from "./errors";
import { type CliSignalTarget, installSignalControl } from "./processSignals";
import { humanPress, parsePress, runPress } from "./remote/press";
import type { ParsedPress } from "./remote/types";

const HELP = `Usage:
  couch device list [--json]
  couch device doctor <target> [--json]
  couch remote press <target> <KEY> [--times N] [--json]

Options:
  --times N  Send the key N times (default: 1)
  --json     Emit one JSON result on stdout
  -h, --help Show this help
`;

type ParsedCommand = ParsedList | ParsedDoctor | ParsedPress;

export interface CliDependencies {
  createInventory?: (
    options?: DeviceInventoryOptions,
  ) => DeviceInventory | Promise<DeviceInventory>;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  signalTarget?: CliSignalTarget;
}

function parseCommand(args: readonly string[]): ParsedCommand {
  if (args[0] === "device" && args[1] === "list") return parseList(args.slice(2));
  if (args[0] === "device" && args[1] === "doctor") return parseDoctor(args.slice(2));
  if (args[0] === "remote" && args[1] === "press") return parsePress(args.slice(2));
  throw new UsageError("expected device list, device doctor, or remote press");
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
  let inventoryPromise: Promise<DeviceInventory> | undefined;
  const getInventory = () => {
    inventoryPromise ??= Promise.resolve(
      createInventory({
        diagnosticSink: (event) => stderr(`${event.level}: ${event.message}\n`),
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
    }
  } finally {
    signals.dispose();
  }
}
