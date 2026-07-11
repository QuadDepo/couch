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

function extractRsaModulusAndExponent(certificatePem: string): RsaKeyComponents {
  const cert = forge.pki.certificateFromPem(certificatePem);
  const publicKey = cert.publicKey as forge.pki.rsa.PublicKey;

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
