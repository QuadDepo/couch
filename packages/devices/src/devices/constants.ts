const BASE_RETRY_DELAY = 1000;

const MAX_RETRY_DELAY = 8000;

const RETRY_BACKOFF_MULTIPLIER = 2;

export const HEARTBEAT_INTERVAL = 30000;

export function calculateRetryDelay(retryCount: number): number {
  return Math.min(BASE_RETRY_DELAY * RETRY_BACKOFF_MULTIPLIER ** retryCount, MAX_RETRY_DELAY);
}
