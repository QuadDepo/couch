import { describe, expect, test } from "bun:test";
import { calculateRetryDelay } from "./constants";

describe("calculateRetryDelay", () => {
  test("should return 1000ms for first retry (retryCount 0)", () => {
    expect(calculateRetryDelay(0)).toBe(1000);
  });

  test("should return 2000ms for second retry (retryCount 1)", () => {
    expect(calculateRetryDelay(1)).toBe(2000);
  });

  test("should return 4000ms for third retry (retryCount 2)", () => {
    expect(calculateRetryDelay(2)).toBe(4000);
  });

  test("should cap at 8000ms for retryCount 3 and above", () => {
    expect(calculateRetryDelay(3)).toBe(8000);
    expect(calculateRetryDelay(5)).toBe(8000);
    expect(calculateRetryDelay(10)).toBe(8000);
  });
});
