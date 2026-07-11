export function now(): string {
  return new Date().toISOString();
}

// Races `entrant` against a timer; on timeout the winning value comes from `onTimeout`,
// whose side effects (aborting, flagging) also run before the race resolves.
async function raceTimeout<T>(
  entrant: Promise<T>,
  timeoutMs: number,
  onTimeout: () => T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      entrant,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function settlesWithin(task: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  const settled = task.then(
    () => true,
    () => true,
  );
  return raceTimeout(settled, timeoutMs, () => false);
}

export function succeedsWithin(task: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  const succeeded = task.then(
    () => true,
    () => false,
  );
  return raceTimeout(succeeded, timeoutMs, () => false);
}

export function awaitTimeout(
  task: Promise<unknown>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<void> {
  return raceTimeout(
    task.then(() => undefined),
    timeoutMs,
    onTimeout,
  );
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

export async function awaitWithAbort<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return task;
  let onAbort!: () => void;
  const aborted = new Promise<T>((_, reject) => {
    onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([task, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
