import { describe, expect, test } from "bun:test";
import { createCredentials, validateAndroidTvRemoteCredentials } from "./credentials";

describe("validateAndroidTvRemoteCredentials", () => {
  test("should validate valid credentials with all required fields", () => {
    const result = validateAndroidTvRemoteCredentials({
      certificate: "cert-data",
      privateKey: "key-data",
      serverCertificate: "server-cert-data",
    });
    expect(result.certificate).toBe("cert-data");
    expect(result.privateKey).toBe("key-data");
    expect(result.serverCertificate).toBe("server-cert-data");
  });

  test("should reject empty certificate", () => {
    expect(() =>
      validateAndroidTvRemoteCredentials({
        certificate: "",
        privateKey: "key",
        serverCertificate: "server-cert",
      }),
    ).toThrow();
  });

  test("should reject empty privateKey", () => {
    expect(() =>
      validateAndroidTvRemoteCredentials({
        certificate: "cert",
        privateKey: "",
        serverCertificate: "server-cert",
      }),
    ).toThrow();
  });

  test("should reject empty serverCertificate", () => {
    expect(() =>
      validateAndroidTvRemoteCredentials({
        certificate: "cert",
        privateKey: "key",
        serverCertificate: "",
      }),
    ).toThrow();
  });

  test("should reject missing certificate", () => {
    expect(() =>
      validateAndroidTvRemoteCredentials({
        privateKey: "key",
        serverCertificate: "server-cert",
      }),
    ).toThrow();
  });

  test("should reject missing privateKey", () => {
    expect(() =>
      validateAndroidTvRemoteCredentials({
        certificate: "cert",
        serverCertificate: "server-cert",
      }),
    ).toThrow();
  });

  test("should reject missing serverCertificate", () => {
    expect(() =>
      validateAndroidTvRemoteCredentials({
        certificate: "cert",
        privateKey: "key",
      }),
    ).toThrow();
  });

  test("should accept optional lastUpdated field", () => {
    const result = validateAndroidTvRemoteCredentials({
      certificate: "cert",
      privateKey: "key",
      serverCertificate: "server-cert",
      lastUpdated: "2024-01-01T00:00:00.000Z",
    });
    expect(result.lastUpdated).toBe("2024-01-01T00:00:00.000Z");
  });

  test("should have lastUpdated field in output even if not provided", () => {
    const result = validateAndroidTvRemoteCredentials({
      certificate: "cert",
      privateKey: "key",
      serverCertificate: "server-cert",
    });
    expect(result.lastUpdated).toBeDefined();
  });
});

describe("createCredentials", () => {
  test("should create credentials with all required fields", () => {
    const result = createCredentials({
      certificate: "cert-data",
      privateKey: "key-data",
      serverCertificate: "server-cert-data",
    });
    expect(result.certificate).toBe("cert-data");
    expect(result.privateKey).toBe("key-data");
    expect(result.serverCertificate).toBe("server-cert-data");
    expect(result.lastUpdated).toBeDefined();
  });

  test("should set lastUpdated to current time", () => {
    const before = new Date().toISOString();
    const result = createCredentials({
      certificate: "cert",
      privateKey: "key",
      serverCertificate: "server-cert",
    });
    const after = new Date().toISOString();

    expect(result.lastUpdated).toBeDefined();
    expect(result.lastUpdated >= before).toBe(true);
    expect(result.lastUpdated <= after).toBe(true);
  });
});
