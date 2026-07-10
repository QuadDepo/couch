#!/usr/bin/env bun

import { runCli } from "./cli";

const exitCode = await runCli(process.argv.slice(2));
process.exitCode = exitCode;
