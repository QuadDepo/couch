import { describe, expect, test } from "bun:test";
import { createCredentials, validateTizenCredentials } from "./credentials";

describe("validateTizenCredentials", () => {
  test("should validate valid credentials with token", () => {
    const result = validateTizenCredentials({ token: "abc123" });
    expect(result.token).toBe("abc123");
  });

  test("should validate credentials with MAC address", () => {
    const result = validateTizenCredentials({ token: "key", mac: "AA:BB:CC:DD:EE:FF" });
    expect(result.mac).toBe("AA:BB:CC:DD:EE:FF");
  });

  test("should reject empty token", () => {
    expect(() => validateTizenCredentials({ token: "" })).toThrow();
  });

  test("should accept empty MAC string as default", () => {
    const result = validateTizenCredentials({ token: "key" });
    expect(result.mac).toBe("");
  });
});

describe("createCredentials", () => {
  test("should create credentials with token and default mac", () => {
    const result = createCredentials({ token: "my-token" });
    expect(result.token).toBe("my-token");
    expect(result.mac).toBe("");
  });
});
