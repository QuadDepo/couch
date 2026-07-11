import * as crypto from "node:crypto";
import forge from "node-forge";
import { hexToBytes } from "./hex";

interface GeneratedCertificate {
  certificate: string;
  privateKey: string;
}

export async function generateClientCertificate(): Promise<GeneratedCertificate> {
  // Use async key generation to avoid blocking the event loop (takes 100-500ms)
  const keys = await new Promise<forge.pki.rsa.KeyPair>((resolve, reject) => {
    forge.pki.rsa.generateKeyPair(
      { bits: 2048, workers: -1 },
      (err: Error | null, keypair: forge.pki.rsa.KeyPair) => {
        if (err) {
          reject(err);
        } else {
          resolve(keypair);
        }
      },
    );
  });

  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

  const attrs = [
    { name: "commonName", value: "atvremote" },
    { name: "countryName", value: "US" },
    { shortName: "ST", value: "California" },
    { name: "localityName", value: "Mountain View" },
    { name: "organizationName", value: "Google Inc." },
    { shortName: "OU", value: "Android" },
  ];

  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  cert.sign(keys.privateKey, forge.md.sha256.create());

  return {
    certificate: forge.pki.certificateToPem(cert),
    privateKey: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

interface RsaKeyComponents {
  modulus: Uint8Array;
  exponent: Uint8Array;
}

const UNSUPPORTED_KEY_ERROR =
  "Unsupported certificate: pairing requires an RSA public key, non-RSA keys are not supported";

// The RSA public key carries the modulus (n) and exponent (e); other key types
// (EC, ed25519) lack them and cannot participate in the pairing secret.
function isRsaPublicKey(key: forge.pki.PublicKey): key is forge.pki.rsa.PublicKey {
  return "n" in key && "e" in key;
}

// Peer certificates arrive at the pairing trust boundary, so a non-RSA key must
// fail with a domain-specific error rather than a node-forge internal message.
function extractRsaModulusAndExponent(certificatePem: string): RsaKeyComponents {
  let cert: forge.pki.Certificate;
  try {
    cert = forge.pki.certificateFromPem(certificatePem);
  } catch (error) {
    // node-forge rejects non-RSA public keys during parse ("OID is not RSA").
    const message = error instanceof Error ? error.message : String(error);
    if (/not\s+rsa/i.test(message)) {
      throw new Error(UNSUPPORTED_KEY_ERROR);
    }
    throw error;
  }

  const publicKey = cert.publicKey;
  if (!isRsaPublicKey(publicKey)) {
    throw new Error(UNSUPPORTED_KEY_ERROR);
  }

  const modulusHex = publicKey.n.toString(16);
  const exponentHex = publicKey.e.toString(16);

  const modulusPadded = modulusHex.length % 2 ? `0${modulusHex}` : modulusHex;
  const exponentPadded = exponentHex.length % 2 ? `0${exponentHex}` : exponentHex;

  return {
    modulus: hexToBytes(modulusPadded),
    exponent: hexToBytes(exponentPadded),
  };
}

// Pairing secret = SHA-256(cert1.modulus + cert1.exponent + cert2.modulus + cert2.exponent + code)
// Both sides compute this independently to verify they share the same code
export function computePairingSecret(
  firstCertPem: string,
  secondCertPem: string,
  codeBytes: Uint8Array,
): Uint8Array {
  const firstKey = extractRsaModulusAndExponent(firstCertPem);
  const secondKey = extractRsaModulusAndExponent(secondCertPem);

  const hash = crypto.createHash("sha256");
  hash.update(firstKey.modulus);
  hash.update(firstKey.exponent);
  hash.update(secondKey.modulus);
  hash.update(secondKey.exponent);
  hash.update(codeBytes);

  return new Uint8Array(hash.digest());
}
