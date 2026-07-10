const BASE_RETRY_DELAY = 1000;

const MAX_RETRY_DELAY = 8000;

const RETRY_BACKOFF_MULTIPLIER = 2;

export const HEARTBEAT_INTERVAL = 30000;

export const CONNECTION_TIMEOUT = 30000;

export const MAX_SESSION_RETRIES = 5;

export const PAIRING_CONNECT_TIMEOUT = 15_000;

// Generous: the user must physically act on the TV (accept a prompt, read a PIN/code).
export const PAIRING_USER_INPUT_TIMEOUT = 120_000;

export function calculateRetryDelay(retryCount: number): number {
  return Math.min(BASE_RETRY_DELAY * RETRY_BACKOFF_MULTIPLIER ** retryCount, MAX_RETRY_DELAY);
}
