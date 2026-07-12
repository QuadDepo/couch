import type { WebOSRequestOptions } from "./connectionTypes";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  removeAbortListener: () => void;
}

export interface PendingRequestOptions<T> extends WebOSRequestOptions {
  timeout: number;
  timeoutMessage: string;
  onResolve: (value: unknown) => T;
}

function cancellationError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error("Operation cancelled");
}

export function createPendingRequests() {
  const requests = new Map<string, PendingRequest>();

  function reject(id: string, error: Error): void {
    const request = requests.get(id);
    if (!request) return;
    clearTimeout(request.timeoutId);
    request.removeAbortListener();
    requests.delete(id);
    request.reject(error);
  }

  return {
    has: (id: string) => requests.has(id),
    add<T>(id: string, options: PendingRequestOptions<T>): Promise<T> {
      return new Promise<T>((resolve, rejectPromise) => {
        const abort = () => reject(id, cancellationError(options.signal));
        const timeoutId = setTimeout(
          () => reject(id, new Error(options.timeoutMessage)),
          options.timeoutMs ?? options.timeout,
        );
        const removeAbortListener = () => options.signal?.removeEventListener("abort", abort);

        requests.set(id, {
          resolve: (value) => {
            try {
              resolve(options.onResolve(value));
            } catch (error) {
              rejectPromise(error instanceof Error ? error : new Error(String(error)));
            }
          },
          reject: rejectPromise,
          timeoutId,
          removeAbortListener,
        });

        if (options.signal?.aborted) abort();
        else options.signal?.addEventListener("abort", abort, { once: true });
      });
    },
    resolve(id: string, value: unknown): void {
      const request = requests.get(id);
      if (!request) return;
      clearTimeout(request.timeoutId);
      request.removeAbortListener();
      requests.delete(id);
      request.resolve(value);
    },
    reject,
    rejectAll(error: Error): void {
      for (const id of requests.keys()) reject(id, error);
    },
  };
}
