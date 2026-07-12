export type WebOSTransportErrorCode =
  | "WEBOS_MAIN_OPEN_TIMEOUT"
  | "WEBOS_REGISTRATION_TIMEOUT"
  | "WEBOS_MAIN_SOCKET_ERROR"
  | "WEBOS_MAIN_SOCKET_CLOSED"
  | "WEBOS_POINTER_PATH_TIMEOUT"
  | "WEBOS_POINTER_OPEN_TIMEOUT"
  | "WEBOS_POINTER_SOCKET_ERROR"
  | "WEBOS_POINTER_SOCKET_CLOSED";

export class WebOSTransportError extends Error {
  constructor(
    readonly code: WebOSTransportErrorCode,
    message: string,
    cause?: unknown,
    readonly retryable = true,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WebOSTransportError";
  }
}

export function isRetryableTransportError(error: unknown): error is WebOSTransportError {
  return error instanceof WebOSTransportError && error.retryable;
}

export function safeWebSocketEndpoint(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "unknown endpoint";
  }
}

function redactDiagnostic(message: string, socketUrl: string): string {
  const endpoint = safeWebSocketEndpoint(socketUrl);
  return message
    .replaceAll(socketUrl, endpoint)
    .replace(/\b(?:wss?|https?):\/\/[^\s"']+/gi, (value) => safeWebSocketEndpoint(value))
    .replace(/\/[\w.%~-]+(?:\/[\w.%~-]+)*(?:\?[^\s,)]*)?/g, "[redacted-path]")
    .replace(/([?&](?:client-key|token)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/((?:client-key|token)\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]");
}

function errorMessage(value: unknown): string {
  if (value && typeof value === "object") {
    const event = value as { error?: unknown; message?: unknown };
    if (typeof event.message === "string" && event.message) return event.message;
    if (event.error instanceof Error && event.error.message) return event.error.message;
  }
  return value instanceof Error && value.message ? value.message : "Unknown WebSocket error";
}

function safeCause(value: unknown, socketUrl: string): Error | undefined {
  if (!value || typeof value !== "object") return undefined;
  const event = value as { code?: unknown; error?: unknown };
  const cause = event.error instanceof Error ? event.error : undefined;
  const code = (cause as (Error & { code?: unknown }) | undefined)?.code ?? event.code;
  if (!cause && typeof code !== "string" && typeof code !== "number") return undefined;
  const safe = new Error(redactDiagnostic(cause?.message ?? errorMessage(value), socketUrl));
  if (typeof code === "string" || typeof code === "number") {
    (safe as Error & { code: string | number }).code = code;
  }
  return safe;
}

export function normalizeWebSocketError(
  code: WebOSTransportErrorCode,
  label: string,
  value: unknown,
  socketUrl: string,
  readyState: number,
): WebOSTransportError {
  const message = redactDiagnostic(errorMessage(value), socketUrl);
  return new WebOSTransportError(
    code,
    `${label}: ${message} (endpoint=${safeWebSocketEndpoint(socketUrl)}, readyState=${readyState})`,
    safeCause(value, socketUrl),
  );
}

export function normalizeWebSocketClose(
  code: WebOSTransportErrorCode,
  label: string,
  event: Pick<CloseEvent, "code" | "reason">,
  socketUrl: string,
  readyState: number,
): WebOSTransportError {
  const reason = event.reason ? `, reason=${redactDiagnostic(event.reason, socketUrl)}` : "";
  return new WebOSTransportError(
    code,
    `${label}: code=${event.code}${reason} (endpoint=${safeWebSocketEndpoint(socketUrl)}, readyState=${readyState})`,
    undefined,
    [1001, 1006, 1011, 1012, 1013].includes(event.code),
  );
}
