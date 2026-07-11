const BASE_RETRY_DELAY = 1000;

const MAX_RETRY_DELAY = 8000;

const RETRY_BACKOFF_MULTIPLIER = 2;

export const HEARTBEAT_INTERVAL = 30000;

export const CONNECTION_TIMEOUT = 30000;

export const MAX_SESSION_RETRIES = 5;

export const PAIRING_CONNECT_TIMEOUT = 15_000;

// Generous: the user must physically act on the TV (accept a prompt, read a PIN/code).
export const PAIRING_USER_INPUT_TIMEOUT = 120_000;

export interface BackoffOptions {
  attempt: number;
  baseDelayMs: number;
  maxDelayMs: number;
  multiplier?: number;
}

/** Exponential backoff (`base * multiplier^attempt`) clamped to `maxDelayMs`. */
function cappedExponentialBackoff(options: BackoffOptions): number {
  const { attempt, baseDelayMs, maxDelayMs, multiplier = RETRY_BACKOFF_MULTIPLIER } = options;
  return Math.min(baseDelayMs * multiplier ** attempt, maxDelayMs);
}

export function calculateRetryDelay(retryCount: number): number {
  return cappedExponentialBackoff({
    attempt: retryCount,
    baseDelayMs: BASE_RETRY_DELAY,
    maxDelayMs: MAX_RETRY_DELAY,
    multiplier: RETRY_BACKOFF_MULTIPLIER,
  });
}
