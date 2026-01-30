import { describe, expect, test } from "bun:test";
import { validateWebOSCredentials, createCredentials } from "./credentials";

describe("validateWebOSCredentials", () => {
  test("should validate valid credentials with clientKey", () => {
    const result = validateWebOSCredentials({ clientKey: "abc123" });
    expect(result.clientKey).toBe("abc123");
  });

  test("should reject empty clientKey", () => {
    expect(() => validateWebOSCredentials({ clientKey: "" })).toThrow();
  });

  test("should validate valid MAC address format", () => {
    const result = validateWebOSCredentials({ clientKey: "key", mac: "AA:BB:CC:DD:EE:FF" });
    expect(result.mac).toBe("AA:BB:CC:DD:EE:FF");
  });

  test("should reject invalid MAC address format", () => {
    expect(() => validateWebOSCredentials({ clientKey: "key", mac: "not-a-mac" })).toThrow();
  });

  test("should default mac to empty string and useSsl to false", () => {
    const result = validateWebOSCredentials({ clientKey: "key" });
    expect(result.mac).toBe("");
    expect(result.useSsl).toBe(false);
  });
});

describe("createCredentials", () => {
  test("should create credentials with defaults", () => {
    const result = createCredentials({ clientKey: "key" });
    expect(result.clientKey).toBe("key");
    expect(result.mac).toBe("");
    expect(result.useSsl).toBe(false);
    expect(result.lastUpdated).toBeDefined();
  });
});
