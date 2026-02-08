import * as tls from "node:tls";
import { logger } from "../../../utils/logger";
import type { AndroidTvRemoteCredentials } from "../credentials";
import { computePairingSecret, generateClientCertificate } from "../protocol/certificate";
import { createFrameReader, frameMessage } from "../protocol/framing";
import {
  buildConfiguration,
  buildOptions,
  buildPairingRequest,
  buildSecret,
  parseMessage,
  parseSecretPayload,
} from "../protocol/messages";
import { PAIRING_PORT, PairingMessageType } from "../protocol/schema";

export interface PairingResult {
  credentials: AndroidTvRemoteCredentials;
}

interface PairingState {
  clientCertPem: string;
  clientKeyPem: string;
  serverCertPem: string | null;
  code: string | null;
}

type PairingPhase =
  | "connecting"
  | "waitingForOptions"
  | "waitingForConfigAck"
  | "waitingForCode"
  | "waitingForSecretAck"
  | "complete"
  | "error";

const DEFAULT_PAIRING_TIMEOUT_MS = 30000;

export interface PairingConnectionOptions {
  /** Timeout in milliseconds for pairing operations (default: 30000) */
  timeout?: number;
}

export function createPairingConnection(ip: string, options: PairingConnectionOptions = {}) {
  const { timeout = DEFAULT_PAIRING_TIMEOUT_MS } = options;

  let socket: tls.TLSSocket | null = null;
  let phase: PairingPhase = "connecting";
  let state: PairingState;
  let pairingTimeoutId: ReturnType<typeof setTimeout> | null = null;

  const frameReader = createFrameReader();
  let onCodeReady: (() => void) | null = null;
  let resolveResult: ((result: PairingResult) => void) | null = null;
  let rejectPairing: ((error: Error) => void) | null = null;

  function clearPairingTimeout() {
    if (pairingTimeoutId) {
      clearTimeout(pairingTimeoutId);
      pairingTimeoutId = null;
    }
  }

  function startPairingTimeout(reject: (error: Error) => void, operation: string) {
    clearPairingTimeout();
    pairingTimeoutId = setTimeout(() => {
      logger.error("AndroidTVRemote", `Pairing timeout during ${operation} (${timeout}ms)`);
      phase = "error";
      const error = new Error(`Pairing timeout: TV did not respond during ${operation}`);
      rejectPairing?.(error);
      reject(error);
      disconnect();
    }, timeout);
  }

  // Initialize state without certificates (they'll be generated asynchronously on connect)
  let clientCertPem: string;
  let clientKeyPem: string;

  state = {
    clientCertPem: "",
    clientKeyPem: "",
    serverCertPem: null,
    code: null,
  };

  function handleMessage(data: Uint8Array) {
    logger.debug("AndroidTVRemote", `Received ${data.length} bytes, phase=${phase}`);
    const message = parseMessage(data);
    if (!message) {
      logger.warn("AndroidTVRemote", "Failed to parse message");
      return;
    }

    logger.info("AndroidTVRemote", `Message type=${message.type}, status=${message.status}`);

    switch (message.type) {
      case PairingMessageType.PAIRING_REQUEST_ACK:
        logger.info("AndroidTVRemote", "Received PAIRING_REQUEST_ACK, sending OPTIONS");
        phase = "waitingForConfigAck";
        // Some TVs expect options immediately after ACK, others send OPTIONS first
        sendMessage(buildOptions());
        break;

      case PairingMessageType.OPTIONS:
        logger.info("AndroidTVRemote", "Received OPTIONS from TV, sending CONFIGURATION");
        phase = "waitingForConfigAck";
        sendMessage(buildConfiguration());
        break;

      case PairingMessageType.CONFIGURATION_ACK:
        logger.info("AndroidTVRemote", "Received CONFIGURATION_ACK - ready for code entry");
        phase = "waitingForCode";
        onCodeReady?.();
        break;

      case PairingMessageType.SECRET:
        logger.info("AndroidTVRemote", "Received SECRET from TV");
        handleSecretMessage(message.payload);
        break;

      case PairingMessageType.SECRET_ACK:
        logger.info("AndroidTVRemote", "Received SECRET_ACK - pairing complete!");
        handleSecretAck();
        break;

      default:
        logger.warn("AndroidTVRemote", `Unknown message type: ${message.type}`);
        break;
    }
  }

  function handleSecretMessage(payload: Uint8Array) {
    logger.debug("AndroidTVRemote", `handleSecretMessage: phase=${phase}`);
    const serverSecret = parseSecretPayload(payload);
    if (!serverSecret) {
      logger.warn("AndroidTVRemote", "Failed to parse server secret payload");
      return;
    }

    logger.debug("AndroidTVRemote", `Received server secret: ${toHex(serverSecret)}`);

    if (phase === "waitingForSecretAck" && state.code && state.serverCertPem) {
      // Server computes its secret with certs in opposite order (server, client)
      const codeSuffix = state.code.slice(2);
      const codeBytes = hexToBytes(codeSuffix);
      const expectedSecret = computePairingSecret(
        state.serverCertPem,
        state.clientCertPem,
        codeBytes,
      );

      logger.debug("AndroidTVRemote", `Expected server secret: ${toHex(expectedSecret)}`);

      if (!arraysEqual(serverSecret, expectedSecret)) {
        logger.warn(
          "AndroidTVRemote",
          "Server secret mismatch - continuing anyway (some TVs don't match exactly)",
        );
      } else {
        logger.info("AndroidTVRemote", "Server secret verified successfully");
      }
    }
  }

  function handleSecretAck() {
    clearPairingTimeout();
    phase = "complete";
    if (state.serverCertPem) {
      resolveResult?.({
        credentials: {
          certificate: state.clientCertPem,
          privateKey: state.clientKeyPem,
          serverCertificate: state.serverCertPem,
          lastUpdated: new Date().toISOString(),
        },
      });
    }
    disconnect();
  }

  function sendMessage(data: Uint8Array) {
    if (socket?.writable) {
      const framed = frameMessage(data);
      logger.debug("AndroidTVRemote", `Sending ${framed.length} bytes: ${toHex(framed)}`);
      socket.write(framed);
    }
  }

  function toHex(data: Uint8Array): string {
    return Array.from(data)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");
  }

  async function connect(): Promise<void> {
    logger.info("AndroidTVRemote", `Connecting to ${ip}:${PAIRING_PORT} for pairing`);

    // Generate client certificate asynchronously (avoids blocking event loop for 100-500ms)
    logger.debug("AndroidTVRemote", "Generating client certificate...");
    const certData = await generateClientCertificate();
    clientCertPem = certData.certificate;
    clientKeyPem = certData.privateKey;
    state.clientCertPem = clientCertPem;
    state.clientKeyPem = clientKeyPem;
    logger.debug("AndroidTVRemote", "Client certificate generated");

    return new Promise((resolve, reject) => {
      // Start timeout for initial connection
      startPairingTimeout(reject, "connection");

      socket = tls.connect(
        {
          host: ip,
          port: PAIRING_PORT,
          cert: clientCertPem,
          key: clientKeyPem,
          rejectUnauthorized: false,
        },
        () => {
          logger.info("AndroidTVRemote", "TLS connection established");

          const peerCert = socket?.getPeerCertificate();
          state.serverCertPem = peerCert?.raw
            ? `-----BEGIN CERTIFICATE-----\n${Buffer.from(peerCert.raw).toString("base64")}\n-----END CERTIFICATE-----`
            : null;

          logger.info("AndroidTVRemote", `Got server cert: ${!!state.serverCertPem}`);

          phase = "waitingForOptions";
          logger.info("AndroidTVRemote", "Sending PAIRING_REQUEST");
          sendMessage(buildPairingRequest("Couch Remote", "androidtvremote2"));

          clearPairingTimeout();
          resolve();
        },
      );

      socket.on("data", (data: Buffer) => {
        const bytes = new Uint8Array(data);
        logger.debug("AndroidTVRemote", `Received raw data: ${data.length} bytes: ${toHex(bytes)}`);
        frameReader.append(bytes);
        for (let message = frameReader.read(); message; message = frameReader.read()) {
          handleMessage(message);
        }
      });

      socket.on("error", (error) => {
        clearPairingTimeout();
        logger.error("AndroidTVRemote", `Pairing connection error: ${error.message}`);
        phase = "error";
        rejectPairing?.(error);
        reject(error);
      });

      socket.on("close", () => {
        clearPairingTimeout();
        logger.info("AndroidTVRemote", `Pairing connection closed, phase=${phase}`);
        if (phase !== "complete") {
          rejectPairing?.(new Error("Connection closed unexpectedly"));
        }
      });
    });
  }

  function disconnect() {
    clearPairingTimeout();
    socket?.destroy();
    socket = null;
    frameReader.clear();
  }

  function waitForCode(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (phase === "waitingForCode") {
        resolve();
        return;
      }

      // Start timeout for waiting for TV to show code
      startPairingTimeout(reject, "waiting for TV to display code");

      onCodeReady = () => {
        clearPairingTimeout();
        resolve();
      };
    });
  }

  function submitCode(code: string): Promise<PairingResult> {
    return new Promise((resolve, reject) => {
      if (!/^[0-9A-Fa-f]{6}$/.test(code)) {
        reject(new Error("Invalid code format - must be 6 hex characters"));
        return;
      }

      state.code = code.toUpperCase();
      resolveResult = resolve;
      rejectPairing = reject;

      if (!state.serverCertPem) {
        reject(new Error("Server certificate not available"));
        return;
      }

      // 6-char hex code = 3 bytes: first byte is a check byte,
      // last 2 bytes are the actual code used in the secret hash
      const fullCodeBytes = hexToBytes(state.code);
      const codeSuffix = state.code.slice(2);
      const codeBytes = hexToBytes(codeSuffix);
      const clientSecret = computePairingSecret(
        state.clientCertPem,
        state.serverCertPem,
        codeBytes,
      );

      // Verify: first byte of computed hash must match the check byte
      if (clientSecret[0] !== fullCodeBytes[0]) {
        logger.warn(
          "AndroidTVRemote",
          `Hash check failed: hash[0]=${clientSecret[0]?.toString(16)}, code[0]=${fullCodeBytes[0]?.toString(16)}`,
        );
        reject(new Error("Code verification failed - please check the code and try again"));
        return;
      }

      logger.info("AndroidTVRemote", `Sending SECRET with code suffix: ${codeSuffix}`);
      logger.debug("AndroidTVRemote", `Client secret: ${toHex(clientSecret)}`);
      sendMessage(buildSecret(clientSecret));
      phase = "waitingForSecretAck";

      // Start timeout for SECRET_ACK response
      startPairingTimeout(reject, "waiting for pairing confirmation");
    });
  }

  function getPhase(): PairingPhase {
    return phase;
  }

  return {
    connect,
    disconnect,
    waitForCode,
    submitCode,
    getPhase,
  };
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
