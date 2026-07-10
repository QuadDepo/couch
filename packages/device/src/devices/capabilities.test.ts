import { describe, expect, test } from "bun:test";
import { capabilities as androidTv } from "./android-tv/capabilities";
import { capabilities as androidRemote } from "./android-tv-remote/capabilities";
import { capabilities as lgWebos } from "./lg-webos/capabilities";
import { capabilities as philips } from "./philips-tv/capabilities";
import { capabilities as samsung } from "./samsung-tizen/capabilities";

describe("legacy device capabilities", () => {
  test("do not advertise unsupported app launchers or Wake-on-LAN", () => {
    for (const capabilities of [androidTv, androidRemote, lgWebos, philips, samsung]) {
      expect(capabilities.supportedFeatures.has("app_launcher")).toBe(false);
      expect(capabilities.supportedFeatures.has("wake_on_lan")).toBe(false);
      expect(capabilities.supportsWakeOnLan).toBe(false);
    }
  });
});
