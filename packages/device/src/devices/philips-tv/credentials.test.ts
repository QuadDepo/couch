import { describe, expect, test } from "bun:test";
import { validatePhilipsCredentials } from "./credentials";

describe("validatePhilipsCredentials", () => {
  test("should validate valid credentials with deviceId and authKey", () => {
    const result = validatePhilipsCredentials({ deviceId: "dev-1", authKey: "secret" });
    expect(result.deviceId).toBe("dev-1");
    expect(result.authKey).toBe("secret");
  });

  test("should reject empty deviceId", () => {
    expect(() => validatePhilipsCredentials({ deviceId: "", authKey: "secret" })).toThrow();
  });

  test("should reject empty authKey", () => {
    expect(() => validatePhilipsCredentials({ deviceId: "dev-1", authKey: "" })).toThrow();
  });

  test("should reject missing fields", () => {
    expect(() => validatePhilipsCredentials({})).toThrow();
    expect(() => validatePhilipsCredentials({ deviceId: "dev-1" })).toThrow();
    expect(() => validatePhilipsCredentials({ authKey: "secret" })).toThrow();
  });
});
