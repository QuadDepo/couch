import { describe, expect, test } from "bun:test";
import { getStatusIndicator } from "./statusIndicator";

describe("getStatusIndicator", () => {
  test("should return green filled circle for connected status", () => {
    const result = getStatusIndicator("connected");
    expect(result).toEqual({ icon: "●", color: "#00FF00" });
  });

  test("should return orange empty circle for connecting status", () => {
    const result = getStatusIndicator("connecting");
    expect(result).toEqual({ icon: "○", color: "#FFAA00" });
  });

  test("should return blue half circle for pairing status", () => {
    const result = getStatusIndicator("pairing");
    expect(result).toEqual({ icon: "◐", color: "#00AAFF" });
  });

  test("should return red filled circle for error status", () => {
    const result = getStatusIndicator("error");
    expect(result).toEqual({ icon: "●", color: "#FF4444" });
  });

  test("should return dim empty circle for disconnected status", () => {
    const result = getStatusIndicator("disconnected");
    expect(result).toEqual({ icon: "○", color: "#666666" });
  });
});
