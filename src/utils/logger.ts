import { appendFileSync, writeFileSync } from "node:fs";

const LOG_FILE = "debug.log";
const ENABLED = process.env.DEBUG === "1" || true;

function timestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

function formatMessage(level: string, category: string, message: string, data?: unknown): string {
  const dataStr = data ? ` ${JSON.stringify(data)}` : "";
  return `[${timestamp()}] [${level}] [${category}] ${message}${dataStr}`;
}

export const logger = {
  init() {
    if (!ENABLED) return;
    writeFileSync(LOG_FILE, `[${timestamp()}] === Log started ===\n`);
  },

  info(category: string, message: string, data?: unknown) {
    if (!ENABLED) return;
    const formatted = formatMessage("INFO", category, message, data);
    appendFileSync(LOG_FILE, `${formatted}\n`);
  },

  warn(category: string, message: string, data?: unknown) {
    if (!ENABLED) return;
    const formatted = formatMessage("WARN", category, message, data);
    appendFileSync(LOG_FILE, `${formatted}\n`);
  },

  error(category: string, message: string, data?: unknown) {
    if (!ENABLED) return;
    const formatted = formatMessage("ERR ", category, message, data);
    appendFileSync(LOG_FILE, `${formatted}\n`);
  },

  debug(category: string, message: string, data?: unknown) {
    if (!ENABLED) return;
    const formatted = formatMessage("DEBUG", category, message, data);
    appendFileSync(LOG_FILE, `${formatted}\n`);
  },

  state(category: string, from: string, to: string, event?: string) {
    if (!ENABLED) return;
    const eventStr = event ? ` (${event})` : "";
    const formatted = formatMessage("STATE", category, `${from} → ${to}${eventStr}`);
    appendFileSync(LOG_FILE, `${formatted}\n`);
  },
};
