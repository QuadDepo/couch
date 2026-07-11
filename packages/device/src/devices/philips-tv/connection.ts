// Inspired by https://github.com/suborb/philips_android_tv

import crypto from "node:crypto";
import { logger } from "../../utils/logger";
import { type PhilipsCredentials, validatePhilipsCredentials } from "./credentials";

const API_PORT = 1926;
const API_VERSION = "6";
const SECRET_KEY =
  "ZmVay1EQVFOaZhwQ4Kv81ypLAZNczV9sG4KkseXWn1NEk6cXmPKO/MCa9sryslvLCFMnNe4Z4CPXzToowvhHvA==";

// Bun fetch options to allow self-signed certificates
const fetchOptions = {
  tls: { rejectUnauthorized: false },
} as RequestInit;

const JSON_HEADERS = { "Content-Type": "application/json" };

interface DigestChallenge {
  realm: string;
  nonce: string;
  qop: string;
}

export interface PhilipsConnection {
  request<T>(method: string, endpoint: string, body?: object): Promise<T>;
  startPairing(
    deviceName: string,
  ): Promise<{ authKey: string; timestamp: number; deviceId: string }>;
  confirmPairing(
    pin: string,
    authKey: string,
    timestamp: number,
    deviceId: string,
    deviceName: string,
  ): Promise<PhilipsCredentials>;
}

export function createPhilipsConnection(
  ip: string,
  initialCredentials?: PhilipsCredentials,
): PhilipsConnection {
  let credentials = initialCredentials;
  let nonceCount = 0;

  const baseUrl = `https://${ip}:${API_PORT}/${API_VERSION}`;

  function generateDeviceId(): string {
    return crypto.randomBytes(16).toString("hex");
  }

  function parseDigestChallenge(header: string): DigestChallenge {
    const realm = header.match(/realm="([^"]+)"/)?.[1] ?? "";
    const nonce = header.match(/nonce="([^"]+)"/)?.[1] ?? "";
    const qop = header.match(/qop="([^"]+)"/)?.[1] ?? "auth";
    return { realm, nonce, qop };
  }

  function createDigestHeader(
    method: string,
    uri: string,
    challenge: DigestChallenge,
    username: string,
    password: string,
  ): string {
    nonceCount++;
    const nc = nonceCount.toString(16).padStart(8, "0");
    const cnonce = crypto.randomBytes(8).toString("hex");

    const ha1 = crypto
      .createHash("md5")
      .update(`${username}:${challenge.realm}:${password}`)
      .digest("hex");

    const ha2 = crypto.createHash("md5").update(`${method}:${uri}`).digest("hex");

    const response = crypto
      .createHash("md5")
      .update(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${challenge.qop}:${ha2}`)
      .digest("hex");

    return (
      `Digest username="${username}", realm="${challenge.realm}", ` +
      `nonce="${challenge.nonce}", uri="${uri}", qop=${challenge.qop}, nc=${nc}, ` +
      `cnonce="${cnonce}", response="${response}"`
    );
  }

  function finishPairing(deviceId: string, authKey: string): PhilipsCredentials {
    const validated = validatePhilipsCredentials({ deviceId, authKey });
    credentials = validated;
    return validated;
  }

  // Philips answers an unauthenticated call with a 401 digest challenge, then
  // accepts the same call replayed with a signed Authorization header.
  async function digestFetch(
    method: string,
    endpoint: string,
    username: string,
    password: string,
    body?: string,
  ): Promise<Response> {
    const url = `${baseUrl}${endpoint}`;
    const uri = `/${API_VERSION}${endpoint}`;

    const initial = await fetch(url, { ...fetchOptions, method, headers: JSON_HEADERS, body });
    if (initial.status !== 401) return initial;

    const wwwAuth = initial.headers.get("www-authenticate");
    if (!wwwAuth) throw new Error("No WWW-Authenticate header");

    const challenge = parseDigestChallenge(wwwAuth);
    const authHeader = createDigestHeader(method, uri, challenge, username, password);
    return fetch(url, {
      ...fetchOptions,
      method,
      headers: { ...JSON_HEADERS, Authorization: authHeader },
      body,
    });
  }

  async function request<T>(method: string, endpoint: string, body?: object): Promise<T> {
    const url = `${baseUrl}${endpoint}`;
    const serializedBody = body ? JSON.stringify(body) : undefined;

    const response = credentials
      ? await digestFetch(
          method,
          endpoint,
          credentials.deviceId,
          credentials.authKey,
          serializedBody,
        )
      : await fetch(url, { ...fetchOptions, method, headers: JSON_HEADERS, body: serializedBody });

    if (!response.ok) {
      throw new Error(`${method} ${endpoint} failed: ${response.status}`);
    }

    const text = await response.text();
    return JSON.parse(text || "{}");
  }

  async function startPairing(deviceName: string): Promise<{
    authKey: string;
    timestamp: number;
    deviceId: string;
  }> {
    const deviceId = generateDeviceId();

    const response = await fetch(`${baseUrl}/pair/request`, {
      ...fetchOptions,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: ["read", "write", "control"],
        device: {
          device_name: deviceName,
          device_os: "Linux",
          app_name: deviceName,
          type: "native",
          app_id: `app.${deviceName.toLowerCase()}`,
          id: deviceId,
        },
      }),
    });

    const data = (await response.json()) as {
      auth_key: string;
      timestamp: number;
      error_id: string;
    };

    if (data.error_id !== "SUCCESS") {
      throw new Error(`Pairing request failed: ${data.error_id}`);
    }

    return {
      authKey: data.auth_key,
      timestamp: data.timestamp,
      deviceId,
    };
  }

  async function confirmPairing(
    pin: string,
    authKey: string,
    timestamp: number,
    deviceId: string,
    deviceName: string,
  ): Promise<PhilipsCredentials> {
    const secretKeyBytes = Buffer.from(SECRET_KEY, "base64");
    const signData = `${timestamp}${pin}`;
    // Signature must be base64-encoded hex digest (matching Python reference)
    const hexDigest = crypto.createHmac("sha1", secretKeyBytes).update(signData).digest("hex");
    const signature = Buffer.from(hexDigest).toString("base64");

    logger.info("Philips", "Sending pairing grant request", { timestamp, deviceId });

    const grantBody = JSON.stringify({
      auth: {
        auth_AppId: "1",
        pin,
        auth_timestamp: timestamp,
        auth_signature: signature,
      },
      device: {
        device_name: deviceName,
        device_os: "Android",
        app_name: deviceName,
        type: "native",
        app_id: `app.${deviceName.toLowerCase()}`,
        id: deviceId,
      },
    });

    const response = await digestFetch("POST", "/pair/grant", deviceId, authKey, grantBody);
    const text = await response.text();

    // Some TVs confirm with an empty or non-JSON body; an OK status is the signal.
    if (!text.trim()) {
      if (response.ok) return finishPairing(deviceId, authKey);
      throw new Error(`Pairing failed with status ${response.status}`);
    }

    let data: { error_id?: string };
    try {
      data = JSON.parse(text);
    } catch {
      if (response.ok) return finishPairing(deviceId, authKey);
      throw new Error(`Pairing failed: invalid response - ${text}`);
    }

    if (data.error_id && data.error_id !== "SUCCESS") {
      throw new Error(`Pairing confirmation failed: ${data.error_id}`);
    }

    return finishPairing(deviceId, authKey);
  }

  return {
    request,
    startPairing,
    confirmPairing,
  };
}
