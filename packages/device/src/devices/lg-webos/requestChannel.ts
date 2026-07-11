import { writeFile } from "node:fs";
import { DeviceInventoryError } from "../../errors";
import { logger } from "../../utils/logger";
import { isRecord } from "../../utils/validation";
import { sanitizeWebosRequestError } from "./authorization";
import { cancellationError } from "./cancellation";
import type {
  WebOSRequestMessage,
  WebOSRequestOptions,
  WebOSResponseMessage,
} from "./connectionTypes";
import { createPendingRequests } from "./pendingRequests";
import { getKeyFilePath, PAIRING_MANIFEST } from "./protocol";

const RESPONSE_TYPES = new Set(["registered", "response", "purchased"]);

function parseResponseMessage(value: unknown): WebOSResponseMessage | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id) return undefined;
  if (typeof value.type !== "string" || !RESPONSE_TYPES.has(value.type)) return undefined;
  if (value.payload !== undefined && !isRecord(value.payload)) return undefined;
  return value as unknown as WebOSResponseMessage;
}

function invalidResponseError(): DeviceInventoryError {
  return new DeviceInventoryError(
    "WEBOS_INVALID_RESPONSE",
    "LG webOS returned an invalid protocol response.",
  );
}

export function formatWebosRequestLog(message: WebOSRequestMessage): string {
  const uri = message.uri ? ` uri=${message.uri}` : "";
  return `Sending type=${message.type} id=${message.id}${uri}`;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancellationError(signal);
}

interface RequestChannelOptions {
  ip: string;
  mac?: string;
  timeout: number;
  getClientKey: () => string | undefined;
  setClientKey: (clientKey: string) => void;
  send: (message: WebOSRequestMessage) => void;
  emit: (event: "connect" | "prompt" | "message", ...args: unknown[]) => void;
}

export function createRequestChannel(options: RequestChannelOptions) {
  const pending = createPendingRequests();
  // biome-ignore lint/suspicious/noExplicitAny: WebOS subscription payloads have dynamic shapes that vary by URI
  const subscriptions = new Map<string, (data: any) => void>();
  let cidCount = 0;
  // WebOS correlates each response to its request by `cid`: an 8-hex random
  // prefix plus a 4-hex per-connection counter, e.g. "1a2b3c4d0000".
  const cidPrefix = `0000000${Math.floor(Math.random() * 0xffffffff).toString(16)}`.slice(-8);
  const getCid = () => cidPrefix + `000${(cidCount++).toString(16)}`.slice(-4);

  function send(message: WebOSRequestMessage): void {
    logger.debug("WebOS", formatWebosRequestLog(message));
    options.send(message);
  }

  async function register(requestOptions: WebOSRequestOptions = {}): Promise<void> {
    throwIfAborted(requestOptions.signal);
    const id = getCid();
    const payload: object & { "client-key"?: string } = { ...PAIRING_MANIFEST };
    payload["client-key"] = options.getClientKey();
    const registration = pending.add(id, {
      ...requestOptions,
      timeout: options.timeout,
      timeoutMessage: "Registration timeout",
      onResolve: () => undefined,
    });
    try {
      send({ id, type: "register", payload });
    } catch (error) {
      pending.reject(id, error instanceof Error ? error : new Error(String(error)));
    }
    return registration;
  }

  async function request<T>(
    uri: string,
    payload: object = {},
    requestOptions: WebOSRequestOptions = {},
    // Responses are untyped on the wire; callers wanting a concrete T pass a
    // parser that narrows the payload rather than blindly asserting it.
    parse: (payload: unknown) => T = (value) => value as T,
  ): Promise<T> {
    throwIfAborted(requestOptions.signal);
    const id = getCid();
    const response = pending.add(id, {
      ...requestOptions,
      timeout: options.timeout,
      timeoutMessage: "Request timeout",
      onResolve: parse,
    });
    try {
      send({ id, type: "request", uri, payload });
    } catch (error) {
      pending.reject(id, error instanceof Error ? error : new Error(String(error)));
    }
    return response;
  }

  async function subscribe(
    uri: string,
    payload: object,
    // biome-ignore lint/suspicious/noExplicitAny: WebOS subscription payloads have dynamic shapes that vary by URI
    callback: (data: any) => void,
  ): Promise<void> {
    const id = getCid();
    subscriptions.set(id, callback);
    try {
      send({ id, type: "subscribe", uri, payload });
    } catch (error) {
      subscriptions.delete(id);
      throw error;
    }
  }

  function handleRegistered(message: WebOSResponseMessage): void {
    const clientKey = message.payload?.["client-key"];
    if (typeof clientKey !== "string" || !clientKey.trim()) {
      logger.error("WebOS", "Received invalid registration response");
      pending.reject(message.id, invalidResponseError());
      return;
    }
    options.setClientKey(clientKey);
    writeFile(getKeyFilePath(options.ip, options.mac), clientKey, (error) => {
      if (error) logger.error("WebOS", `Failed to save client key: ${error}`);
    });
    pending.resolve(message.id, message);
    options.emit("connect");
  }

  function handleResponse(message: WebOSResponseMessage): void {
    const payload = message.payload;
    if (payload?.pairingType === "PROMPT" && payload.returnValue === true) {
      options.emit("prompt");
      pending.resolve(message.id, payload);
      return;
    }
    if (pending.has(message.id)) {
      const isFailed =
        !!payload && (!!payload.errorCode || !!payload.errorText || !payload.returnValue);

      if (isFailed) {
        const failureMessage = String(payload?.errorText || payload?.errorCode || "Unknown error");
        pending.reject(
          message.id,
          sanitizeWebosRequestError(new Error(`Request failed: ${failureMessage}`)),
        );
      } else {
        pending.resolve(message.id, payload);
      }
      return;
    }
    if (payload) subscriptions.get(message.id)?.(payload);
  }

  return {
    register,
    request,
    subscribe,
    rejectAll: pending.rejectAll,
    handleMessage(data: string | Buffer) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        logger.error("WebOS", "Received invalid JSON response");
        pending.rejectAll(invalidResponseError());
        return;
      }
      const message = parseResponseMessage(parsed);
      if (!message) {
        logger.error("WebOS", "Received invalid protocol response");
        pending.rejectAll(invalidResponseError());
        return;
      }
      if (message.type === "registered") handleRegistered(message);
      else handleResponse(message);
    },
  };
}
