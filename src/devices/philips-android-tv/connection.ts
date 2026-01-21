// Inspired by https://github.com/suborb/philips_android_tv

import crypto from "crypto";
import { validatePhilipsCredentials, type PhilipsCredentials } from "./credentials";
import { logger } from "../../utils/logger";

const API_PORT = 1926;
const API_VERSION = "6";
const SECRET_KEY = "ZmVay1EQVFOaZhwQ4Kv81ypLAZNczV9sG4KkseXWn1NEk6cXmPKO/MCa9sryslvLCFMnNe4Z4CPXzToowvhHvA==";

// Bun fetch options to allow self-signed certificates
const fetchOptions = {
  tls: { rejectUnauthorized: false },
} as RequestInit;

interface DigestChallenge {
  realm: string;
  nonce: string;
  qop: string;
}

export interface PhilipsConnection {
  request<T>(method: string, endpoint: string, body?: object): Promise<T>;
  startPairing(deviceName: string): Promise<{ authKey: string; timestamp: number; deviceId: string }>;
  confirmPairing(pin: string, authKey: string, timestamp: number, deviceId: string, deviceName: string): Promise<PhilipsCredentials>;
  setCredentials(credentials: PhilipsCredentials): void;
  hasCredentials(): boolean;
}

export function createPhilipsConnection(ip: string, initialCredentials?: PhilipsCredentials): PhilipsConnection {
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
    password: string
  ): string {
    nonceCount++;
    const nc = nonceCount.toString(16).padStart(8, "0");
    const cnonce = crypto.randomBytes(8).toString("hex");

    const ha1 = crypto
      .createHash("md5")
      .update(`${username}:${challenge.realm}:${password}`)
      .digest("hex");

    const ha2 = crypto
      .createHash("md5")
      .update(`${method}:${uri}`)
      .digest("hex");

    const response = crypto
      .createHash("md5")
      .update(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${challenge.qop}:${ha2}`)
      .digest("hex");

    return `Digest username="${username}", realm="${challenge.realm}", ` +
      `nonce="${challenge.nonce}", uri="${uri}", qop=${challenge.qop}, nc=${nc}, ` +
      `cnonce="${cnonce}", response="${response}"`;
  }

  async function request<T>(method: string, endpoint: string, body?: object): Promise<T> {
    const uri = `/${API_VERSION}${endpoint}`;
    const url = `${baseUrl}${endpoint}`;

    const options: RequestInit = {
      ...fetchOptions,
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    };

    const initialResponse = await fetch(url, options);

    if (initialResponse.status !== 401 || !credentials) {
      if (!initialResponse.ok) {
        throw new Error(`Request failed: ${initialResponse.status}`);
      }
      const text = await initialResponse.text();
      return text ? JSON.parse(text) : ({} as T);
    }

    const wwwAuth = initialResponse.headers.get("www-authenticate");
    if (!wwwAuth) throw new Error("No WWW-Authenticate header");

    const challenge = parseDigestChallenge(wwwAuth);
    if (!credentials) throw new Error("No credentials available");
    const authHeader = createDigestHeader(method, uri, challenge, credentials.deviceId, credentials.authKey);

    const authResponse = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
    });

    if (!authResponse.ok) {
      throw new Error(`Authenticated request failed: ${authResponse.status}`);
    }

    const text = await authResponse.text();
    return text ? JSON.parse(text) : ({} as T);
  }

  async function startPairing(deviceName: string = "BaghdadRemote"): Promise<{
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
    deviceName: string = "BaghdadRemote"
  ): Promise<PhilipsCredentials> {
    const secretKeyBytes = Buffer.from(SECRET_KEY, "base64");
    const signData = `${timestamp}${pin}`;
    // Signature must be base64-encoded hex digest (matching Python reference)
    const hexDigest = crypto
      .createHmac("sha1", secretKeyBytes)
      .update(signData)
      .digest("hex");
    const signature = Buffer.from(hexDigest).toString("base64");

    logger.info("Philips", "Sending pairing grant request", { timestamp, deviceId, signature });

    const grantUrl = `${baseUrl}/pair/grant`;
    const uri = `/${API_VERSION}/pair/grant`;
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

    // First request to get digest challenge (will return 401)
    const initialResponse = await fetch(grantUrl, {
      ...fetchOptions,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: grantBody,
    });

    logger.info("Philips", "Initial grant response", { status: initialResponse.status });

    if (initialResponse.status !== 401) {
      // Unexpected - should require auth
      const text = await initialResponse.text();
      logger.info("Philips", "Unexpected response (expected 401)", { body: text });
      if (initialResponse.ok) {
        const validated = validatePhilipsCredentials({ deviceId, authKey });
        credentials = validated;
        return validated;
      }
      throw new Error(`Pairing failed: unexpected status ${initialResponse.status}`);
    }

    // Get digest challenge and create auth header
    const wwwAuth = initialResponse.headers.get("www-authenticate");
    if (!wwwAuth) throw new Error("No WWW-Authenticate header in grant response");

    const challenge = parseDigestChallenge(wwwAuth);
    const authHeader = createDigestHeader("POST", uri, challenge, deviceId, authKey);

    logger.info("Philips", "Sending authenticated grant request");

    // Make authenticated request
    const authResponse = await fetch(grantUrl, {
      ...fetchOptions,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: grantBody,
    });

    logger.info("Philips", "Grant response", { status: authResponse.status, ok: authResponse.ok });

    const text = await authResponse.text();
    logger.info("Philips", "Grant response body", { body: text });

    // Handle empty response as success (some TVs do this)
    if (!text || text.trim() === "") {
      if (authResponse.ok) {
        logger.info("Philips", "Empty response with OK status, treating as success");
        const validated = validatePhilipsCredentials({ deviceId, authKey });
        credentials = validated;
        return validated;
      }
      throw new Error(`Pairing failed with status ${authResponse.status}`);
    }

    let data: { error_id?: string };
    try {
      data = JSON.parse(text);
    } catch {
      // If we can't parse but response was OK, assume success
      if (authResponse.ok) {
        logger.info("Philips", "Non-JSON response with OK status, treating as success");
        const validated = validatePhilipsCredentials({ deviceId, authKey });
        credentials = validated;
        return validated;
      }
      throw new Error(`Pairing failed: invalid response - ${text}`);
    }

    if (data.error_id && data.error_id !== "SUCCESS") {
      throw new Error(`Pairing confirmation failed: ${data.error_id}`);
    }

    const validated = validatePhilipsCredentials({ deviceId, authKey });
    credentials = validated;
    return validated;
  }

  function setCredentials(creds: PhilipsCredentials): void {
    credentials = creds;
  }

  function hasCredentials(): boolean {
    return credentials !== undefined;
  }

  return {
    request,
    startPairing,
    confirmPairing,
    setCredentials,
    hasCredentials,
  };
}
