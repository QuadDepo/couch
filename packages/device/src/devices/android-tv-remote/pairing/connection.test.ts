import { afterEach, expect, test } from "bun:test";
import * as tls from "node:tls";
import { PAIRING_PORT } from "../protocol/schema";
import { createPairingConnection } from "./connection";

// Static self-signed RSA key/cert for a fake TV. The pairing client uses
// rejectUnauthorized:false, so any valid cert completes the handshake.
const SERVER_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDDCVRRe+RcDnUt
jjwHj3gUxX27N2mrbtXaLF76A0brwlJpao8GKvimIYlJ9IzdoorUBMCy+cdPmm0+
XjzsMdhcQDi61fRvlDDRjHKwKK+RIeF3Tv9x+6AKnqSWCZmd6Yr9b65kv4oj0YiE
VGExeBqT/q7J2KHK3f9nIyj9v6yy/1rZ+d6DxpuVf1sXLQwX+uaoVe7UHDQfs84R
UJ3CEWbO5kMxOhotl3TIR9aVRqw53/8lD3GsnQ4ozIM9Jk4R18YtWT/yQnGN/3El
BMV7uND7OOyHLvFBIdtiD+sUYUmAmihsPzKcrW6T/XRDuKzSm9rcUiTlWa0C3b6W
3QWRaIg1AgMBAAECggEAJx5SKeTETP1+XbSDUE3jmyDwYrJO0LpyjKetJg6ttSA8
6NVdWfKY/DNKRsnUzihpmXRZlRw5sHrsEeATbplhyMD9z+WVeSK7NvBpWXFTo3Os
9gHjhOBf/XlL0CcdR1m+Da6OhzkOszf13nrRIruw8wGYW7ZGXzrvHOflsx10fVMV
rwfUFKD3EUvkbV9HNG/gDG+5n5czTF1ifogCGo8GinuOPKd9eKrGRJJIscZpJeIk
19xlf5eTibVyN3tmohfoMZ4GnTV+RMQq5WK7sp64Dghp9j382hl+zA1RCkJpCTVh
O5jFi060sMgrZbgxAdmHZ0bbCuiyHamalzdcqtNx2QKBgQD32bOftc0Exv066rVH
OMVbg7cl2Q4HZje4UgpVxKSdFTyHX83h3pMyt+p/H9v0b+ca7Zaws00AbvpbscLu
j6MbT4z6qvKYC6jnttf3pyVPDz77oPWVSWTyiM4gZTsYpKbBvjFRDfo1f15rCZTf
wbSxKW+mokyhus+mV/JELopEeQKBgQDJcw//yGixV31dTBFRIAWcHpySzbXP1ciq
ScE1KSZS58OwrwoNLVz11cqKSxb8FWoaTgeC+pY+2N62dO+AaZpCrBegWxeOaB7V
eKP7gg9w57J8VK9ZdqNa22glmBiYmkV9xLz48OezGrDI0G9hgJWTRO5WemfBYTaL
kD4ZGFpanQKBgQCKEUA6y++1pZQTagQp9LocTLeN4egqvwpzJ2CSfsSkrNvXHct2
86JUMpfy0TCabmvzWD8FmBxhDXFx+wh4FJPr9ti2GtyhTn189yI/12C1Ne0EB5pG
22fco9EPwtS02aP7cZPPb1Xez2Eth1zjeOjLeCW2UdsWjRZ3t65BxRtJIQKBgCe7
eAZdArknpmRGYov7ot+d8gfKZvetFLzxexf/G73yVFh+zZ63ucQK/L21/byOhLTX
ewfMYOHYaGTYP3y2V2SbCLXqAYVm5932w3ERv/Xm3P9EvKkKi0GaULpJe2Bt3RLn
QNZgvXJH62JQKgezEs1PJSsNTXWItPdl5bmRYhDJAoGAERXKsYwbcTfex1k2h5y0
720Jt3cjdHpt3XFH3LKFA5ka/VnU+w8kJLsinfaFUQguqGKjHho1q71UekWH82wt
c9B3AHpH6o0K0lkcPj3ilTwJYDdGDkNo3P4ITWHQxhjTnejhFvF98mAgPvJCdxd4
WHBci4hi7vrZn+w6K05cPtc=
-----END PRIVATE KEY-----`;

const SERVER_CERT = `-----BEGIN CERTIFICATE-----
MIIDAzCCAeugAwIBAgIUX9WO+YIb9GgYstHLvcHUQsfYc5UwDQYJKoZIhvcNAQEL
BQAwETEPMA0GA1UEAwwGZmFrZXR2MB4XDTI2MDcxMTEyMDYxNloXDTM2MDcwODEy
MDYxNlowETEPMA0GA1UEAwwGZmFrZXR2MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A
MIIBCgKCAQEAwwlUUXvkXA51LY48B494FMV9uzdpq27V2ixe+gNG68JSaWqPBir4
piGJSfSM3aKK1ATAsvnHT5ptPl487DHYXEA4utX0b5Qw0YxysCivkSHhd07/cfug
Cp6klgmZnemK/W+uZL+KI9GIhFRhMXgak/6uydihyt3/ZyMo/b+ssv9a2fneg8ab
lX9bFy0MF/rmqFXu1Bw0H7POEVCdwhFmzuZDMToaLZd0yEfWlUasOd//JQ9xrJ0O
KMyDPSZOEdfGLVk/8kJxjf9xJQTFe7jQ+zjshy7xQSHbYg/rFGFJgJoobD8ynK1u
k/10Q7is0pva3FIk5VmtAt2+lt0FkWiINQIDAQABo1MwUTAdBgNVHQ4EFgQU2iHA
9lS+sDqRyAOBGA/vhfdFUqEwHwYDVR0jBBgwFoAU2iHA9lS+sDqRyAOBGA/vhfdF
UqEwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAOQPZpdZbg/lh
Ozs2Aob6zQ/O7P4rf8c3XQHGqPm2F9lM6j97QXPzaskV/PBWIP0xEkWpyfpvxdFX
h06/rtZGvUDmgqe3SSt7qEz7I/POATAfiHLvn5Fg6OCUfGGYmtYRd7zIMrXF6jYB
cDPfFyE2+q7RLKKylGH4crURBjFQM4otM2tOezK9mCSJDCLQD2CzesSvn63WA9Un
w1JRkahIclxt2yCFXF+/fRmb9jpNL5r2S1WNPo8RsVFbqnBOZTM5FSnNvxdaqF9O
c13OczYyK8bu9e3CIvRDhKaXW/2cHU2fhYMID8q2g4JtBNoKqZ0IzzBvZFbGYWux
BJQeDyYy0A==
-----END CERTIFICATE-----`;

let server: tls.Server | null = null;

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
  server = null;
});

// A fake TV that completes the TLS handshake and then drops the connection a
// moment later -- the TV disconnecting while the user is still reading the code.
function startDroppingServer(): Promise<void> {
  return new Promise((resolve) => {
    server = tls.createServer({ key: SERVER_KEY, cert: SERVER_CERT }, (socket) => {
      socket.on("error", () => {});
      setTimeout(() => socket.destroy(), 100);
    });
    server.listen(PAIRING_PORT, "127.0.0.1", () => resolve());
  });
}

// When the connection drops while waitForCode() is pending, the operation must
// reject with a connection-lost error through the single shared settlement path
// -- not hang forever, and not surface an unrelated pairing-timeout message.
test("waitForCode rejects with a connection error when the socket drops", async () => {
  await startDroppingServer();
  const conn = createPairingConnection("127.0.0.1", { timeout: 500 });
  await conn.connect();

  const outcome: { rejected: boolean; message?: string } = { rejected: false };
  const pending = conn.waitForCode().then(
    () => {},
    (err: Error) => {
      outcome.rejected = true;
      outcome.message = err.message;
    },
  );

  // Bounded wait so a never-settling promise does not hang the runner.
  await new Promise((resolve) => setTimeout(resolve, 900));
  await Promise.race([pending, Promise.resolve()]);
  conn.disconnect();

  expect(outcome.rejected).toBe(true);
  expect(outcome.message ?? "").toMatch(/clos|lost|disconnect|reset|end/i);
});
