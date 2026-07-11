import { appendFileSync, writeFileSync } from "node:fs";

const LOG_FILE = "debug.log";
const ENABLED = process.env.DEBUG === "1";

function timestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

function formatMessage(level: string, category: string, message: string, data?: unknown): string {
  const dataStr = data ? ` ${JSON.stringify(data)}` : "";
  return `[${timestamp()}] [${level}] [${category}] ${message}${dataStr}`;
}

function log(level: string, category: string, message: string, data?: unknown): void {
  if (!ENABLED) return;
  appendFileSync(LOG_FILE, `${formatMessage(level, category, message, data)}\n`);
}

export const logger = {
  init() {
    if (!ENABLED) return;
    writeFileSync(LOG_FILE, `[${timestamp()}] === Log started ===\n`);
  },

  info: (category: string, message: string, data?: unknown) => log("INFO", category, message, data),
  warn: (category: string, message: string, data?: unknown) => log("WARN", category, message, data),
  error: (category: string, message: string, data?: unknown) =>
    log("ERR ", category, message, data),
  debug: (category: string, message: string, data?: unknown) =>
    log("DEBUG", category, message, data),
};
