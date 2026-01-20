import { appendFileSync, writeFileSync } from "fs";

const LOG_FILE = "debug.log";
const ENABLED = process.env.DEBUG === "1" || true;

function timestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

function formatMessage(level: string, category: string, message: string, data?: unknown): string {
  const dataStr = data ? ` ${JSON.stringify(data)}` : "";
  return `[${timestamp()}] [${level}] [${category}] ${message}${dataStr}\n`;
}

export const logger = {
  init() {
    if (!ENABLED) return;
    writeFileSync(LOG_FILE, `[${timestamp()}] === Log started ===\n`);
  },

  info(category: string, message: string, data?: unknown) {
    if (!ENABLED) return;
    appendFileSync(LOG_FILE, formatMessage("INFO", category, message, data));
  },

  warn(category: string, message: string, data?: unknown) {
    if (!ENABLED) return;
    appendFileSync(LOG_FILE, formatMessage("WARN", category, message, data));
  },

  error(category: string, message: string, data?: unknown) {
    if (!ENABLED) return;
    appendFileSync(LOG_FILE, formatMessage("ERR ", category, message, data));
  },

  state(category: string, from: string, to: string, event?: string) {
    if (!ENABLED) return;
    const eventStr = event ? ` (${event})` : "";
    appendFileSync(LOG_FILE, formatMessage("STATE", category, `${from} → ${to}${eventStr}`));
  },
};
