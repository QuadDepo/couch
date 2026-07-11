import { UsageError } from "./errors";

export interface ValueOption {
  flag: string;
  // Shown when the value is missing or looks like another option.
  message: string;
}

export interface ParsedOptions {
  json: boolean;
  values: Record<string, string>;
}

function duplicateOption(flag: string): UsageError {
  return new UsageError(`${flag} may only be specified once`);
}

// Parses the shared `--json` flag plus a fixed set of `--flag <value>` options,
// starting from `startIndex` (after any positional arguments the command owns).
// Duplicates and unknown flags fail with a message naming the specific flag.
export function parseOptions(
  args: readonly string[],
  startIndex: number,
  valueOptions: readonly ValueOption[] = [],
): ParsedOptions {
  let json = false;
  const values: Record<string, string> = {};

  for (let index = startIndex; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--json") {
      if (json) throw duplicateOption("--json");
      json = true;
      continue;
    }

    const option = valueOptions.find((candidate) => candidate.flag === argument);
    if (option) {
      if (values[option.flag] !== undefined) throw duplicateOption(option.flag);
      const value = args[index + 1];
      if (!value || value.startsWith("-")) throw new UsageError(option.message);
      values[option.flag] = value;
      index += 1;
      continue;
    }

    throw new UsageError(`unknown option: ${argument}`);
  }

  return { json, values };
}
