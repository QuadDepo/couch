const pendingHandoffs = new Map<string, Promise<void>>();

/**
 * Serialize teardown per lock resource: chain each session's cleanup after the
 * previous one so a reconnecting session waits for the prior driver to finish
 * closing (and releasing its lock) before it acquires again.
 */
export function publishSessionHandoff(resourceId: string, cleanup: Promise<void>): void {
  const previous = pendingHandoffs.get(resourceId);
  // Teardown errors are already logged at their source (driver.close, lock.release);
  // swallow here so one failed cleanup can't wedge the handoff chain for the resource.
  const serializedTeardown = (previous ? previous.then(() => cleanup) : cleanup).catch(
    () => undefined,
  );
  pendingHandoffs.set(resourceId, serializedTeardown);
  void serializedTeardown.finally(() => {
    if (pendingHandoffs.get(resourceId) === serializedTeardown) pendingHandoffs.delete(resourceId);
  });
}

export async function awaitSessionHandoff(resourceId: string): Promise<void> {
  await pendingHandoffs.get(resourceId);
}
