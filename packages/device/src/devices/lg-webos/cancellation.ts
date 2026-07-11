// A cancelled operation rejects with the signal's own reason when the caller
// supplied one, otherwise a generic cancellation error.
export function cancellationError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error("Operation cancelled");
}
