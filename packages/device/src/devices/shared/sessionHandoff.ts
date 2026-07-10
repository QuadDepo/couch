const pendingHandoffs = new Map<string, Promise<void>>();

export function publishSessionHandoff(resourceId: string, cleanup: Promise<void>): void {
  const previous = pendingHandoffs.get(resourceId);
  const combined = (previous ? previous.then(() => cleanup) : cleanup).catch(() => undefined);
  pendingHandoffs.set(resourceId, combined);
  void combined.finally(() => {
    if (pendingHandoffs.get(resourceId) === combined) pendingHandoffs.delete(resourceId);
  });
}

export async function awaitSessionHandoff(resourceId: string): Promise<void> {
  await pendingHandoffs.get(resourceId);
}
