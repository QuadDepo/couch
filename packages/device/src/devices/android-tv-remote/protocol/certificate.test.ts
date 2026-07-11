import { expect, test } from "bun:test";
import { computePairingSecret } from "./certificate";

// A self-signed prime256v1 (EC) certificate -- a valid X.509 cert whose public
// key is NOT RSA. Stands in for a malicious/misconfigured peer (TV) certificate
// arriving at the pairing trust boundary.
const EC_CERT = `-----BEGIN CERTIFICATE-----
MIIBfTCCASOgAwIBAgIUb8aWZnJNtbQHcI9/JduC/0NV+OowCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJYXR2cmVtb3RlMB4XDTI2MDcxMTEyMDI0OFoXDTI3MDcxMTEy
MDI0OFowFDESMBAGA1UEAwwJYXR2cmVtb3RlMFkwEwYHKoZIzj0CAQYIKoZIzj0D
AQcDQgAEEoBhAERLIer5dlo26Q4n5dbCnHYEQJb4b47s+Yz/BXJyaFmIyYYM1h7y
rF1cI7v0iKz+WevufIBzWHB6YXN4RqNTMFEwHQYDVR0OBBYEFCCbzh67+ULBC+Wc
VEHTts+hKAMYMB8GA1UdIwQYMBaAFCCbzh67+ULBC+WcVEHTts+hKAMYMA8GA1Ud
EwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSAAwRQIgTaKYowLGmyqL3w4j1vSObXsT
6pSkaj3fSKZQJ34kgCsCIQDnsNfxwXtXvHeHXGuYDs0HkzHZ9PQ6s/QsiLeePmxB
+Q==
-----END CERTIFICATE-----`;

// computePairingSecret assumes an RSA public key; a non-RSA peer certificate at
// the pairing trust boundary must fail with a domain-specific unsupported-key
// error rather than leaking node-forge's internal "OID is not RSA." message.
test("computePairingSecret rejects a non-RSA certificate with a specific unsupported-key error", () => {
  expect(() => computePairingSecret(EC_CERT, EC_CERT, new Uint8Array([0x01, 0x02]))).toThrow(
    /unsupported|not supported|key type/i,
  );
});
