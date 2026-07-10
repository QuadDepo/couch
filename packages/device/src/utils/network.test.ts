import { describe, expect, test } from "bun:test";
import { isValidIp } from "./network";

describe("isValidIp", () => {
  test("should return true for valid IPv4 addresses", () => {
    expect(isValidIp("192.168.1.1")).toBe(true);
    expect(isValidIp("10.0.0.1")).toBe(true);
    expect(isValidIp("255.255.255.255")).toBe(true);
  });

  test("should return true for valid IPv6 addresses", () => {
    expect(isValidIp("::1")).toBe(true);
    expect(isValidIp("fe80::1")).toBe(true);
  });

  test("should return false for invalid IP strings", () => {
    expect(isValidIp("not-an-ip")).toBe(false);
    expect(isValidIp("256.1.1.1")).toBe(false);
    expect(isValidIp("")).toBe(false);
    expect(isValidIp("192.168.1")).toBe(false);
  });
});
