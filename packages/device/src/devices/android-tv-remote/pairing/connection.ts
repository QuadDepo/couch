import * as tls from "node:tls";
import { logger } from "../../../utils/logger";
import type { AndroidTvRemoteCredentials } from "../credentials";
import { computePairingSecret, generateClientCertificate } from "../protocol/certificate";
import { createFrameReader, frameMessage } from "../protocol/framing";
import { hexToBytes } from "../protocol/hex";
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
  // Certificates are generated asynchronously on connect; state is the single
  // source of truth for both client and server PEMs.
  const state: PairingState = {
    clientCertPem: "",
    clientKeyPem: "",
    serverCertPem: null,
    code: null,
  };
  let pairingTimeoutId: ReturnType<typeof setTimeout> | null = null;

  const frameReader = createFrameReader();
  let onCodeReady: (() => void) | null = null;
  let resolveResult: ((result: PairingResult) => void) | null = null;
  // Exactly one pairing operation (connect / waitForCode / submitCode) is in
  // flight at a time. Its rejection lives here so connection-level events
  // (timeout, socket error, close) settle the awaited operation through one
  // path. Success paths call operationResolved() to clear it.
  let rejectActiveOperation: ((error: Error) => void) | null = null;

  function clearPairingTimeout() {
    if (pairingTimeoutId) {
      clearTimeout(pairingTimeoutId);
      pairingTimeoutId = null;
    }
  }

  function beginOperation(operation: string, reject: (error: Error) => void) {
    rejectActiveOperation = reject;
    clearPairingTimeout();
    pairingTimeoutId = setTimeout(() => {
      logger.error("AndroidTVRemote", `Pairing timeout during ${operation} (${timeout}ms)`);
      failActiveOperation(new Error(`Pairing timeout: TV did not respond during ${operation}`));
      disconnect();
    }, timeout);
  }

  // Reject the in-flight operation exactly once and stop its timeout.
  function failActiveOperation(error: Error) {
    clearPairingTimeout();
    const reject = rejectActiveOperation;
    rejectActiveOperation = null;
    if (reject) {
      phase = "error";
      reject(error);
    }
  }

  // The in-flight operation resolved on its own success event; stop treating
  // later connection events as a failure for it.
  function operationResolved() {
    clearPairingTimeout();
    rejectActiveOperation = null;
  }

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
    verifyServerSecret(serverSecret);
  }

  function verifyServerSecret(serverSecret: Uint8Array) {
    if (phase !== "waitingForSecretAck") return;
    if (!state.code) return;
    if (!state.serverCertPem) return;

    // Server derives its secret with the certs in the opposite order (server, client).
    const codeBytes = hexToBytes(state.code.slice(2));
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
      return;
    }
    logger.info("AndroidTVRemote", "Server secret verified successfully");
  }

  function handleSecretAck() {
    if (!state.serverCertPem) {
      // Credentials cannot be built without the server cert; fail the pending
      // submitCode rather than silently completing with no result.
      failActiveOperation(
        new Error("Pairing failed: server certificate unavailable at pairing confirmation"),
      );
      disconnect();
      return;
    }

    operationResolved();
    phase = "complete";
    resolveResult?.({
      credentials: {
        certificate: state.clientCertPem,
        privateKey: state.clientKeyPem,
        serverCertificate: state.serverCertPem,
        lastUpdated: new Date().toISOString(),
      },
    });
    resolveResult = null;
    disconnect();
  }

  function sendMessage(data: Uint8Array) {
    if (!socket?.writable) {
      throw new Error(`Pairing send failed: socket not writable during ${phase}`);
    }
    const framed = frameMessage(data);
    logger.debug("AndroidTVRemote", `Sending ${framed.length} bytes: ${toHex(framed)}`);
    socket.write(framed);
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
    state.clientCertPem = certData.certificate;
    state.clientKeyPem = certData.privateKey;
    logger.debug("AndroidTVRemote", "Client certificate generated");

    return new Promise((resolve, reject) => {
      beginOperation("connection", reject);

      const conn = tls.connect(
        {
          host: ip,
          port: PAIRING_PORT,
          cert: state.clientCertPem,
          key: state.clientKeyPem,
          rejectUnauthorized: false,
        },
        () => {
          logger.info("AndroidTVRemote", "TLS connection established");

          const peerCert = conn.getPeerCertificate();
          state.serverCertPem = peerCert?.raw
            ? `-----BEGIN CERTIFICATE-----\n${Buffer.from(peerCert.raw).toString("base64")}\n-----END CERTIFICATE-----`
            : null;

          logger.info("AndroidTVRemote", `Got server cert: ${!!state.serverCertPem}`);

          phase = "waitingForOptions";
          logger.info("AndroidTVRemote", "Sending PAIRING_REQUEST");
          sendMessage(buildPairingRequest("Couch Remote", "androidtvremote2"));

          operationResolved();
          resolve();
        },
      );
      socket = conn;

      conn.on("data", (data: Buffer) => {
        const bytes = new Uint8Array(data);
        logger.debug("AndroidTVRemote", `Received raw data: ${data.length} bytes: ${toHex(bytes)}`);
        try {
          frameReader.append(bytes);
          for (let message = frameReader.read(); message; message = frameReader.read()) {
            handleMessage(message);
          }
        } catch (error) {
          // Invalid framing or a failed send desyncs pairing; fail the pending
          // operation with a specific error instead of throwing out of the
          // socket's data listener.
          const err = error instanceof Error ? error : new Error(String(error));
          logger.error("AndroidTVRemote", `Pairing message handling failed: ${err.message}`);
          failActiveOperation(err);
          disconnect();
        }
      });

      conn.on("error", (error: Error) => {
        logger.error("AndroidTVRemote", `Pairing connection error: ${error.message}`);
        failActiveOperation(error);
      });

      conn.on("close", () => {
        logger.info("AndroidTVRemote", `Pairing connection closed, phase=${phase}`);
        if (phase !== "complete") {
          failActiveOperation(new Error("Pairing connection closed unexpectedly"));
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

      beginOperation("waiting for TV to display code", reject);

      onCodeReady = () => {
        operationResolved();
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
      // handleSecretAck resolves this once the TV confirms the pairing.
      resolveResult = resolve;
      sendMessage(buildSecret(clientSecret));
      phase = "waitingForSecretAck";

      beginOperation("waiting for pairing confirmation", reject);
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

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
