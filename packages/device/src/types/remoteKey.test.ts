import { describe, expect, test } from "bun:test";
import { isRemoteKey, REMOTE_KEYS } from "./index";

describe("remote keys", () => {
  test("provides runtime validation for the shared key vocabulary", () => {
    expect(REMOTE_KEYS).toContain("LEFT");
    expect(isRemoteKey("LEFT")).toBe(true);
    expect(isRemoteKey("NOPE")).toBe(false);
  });
});
