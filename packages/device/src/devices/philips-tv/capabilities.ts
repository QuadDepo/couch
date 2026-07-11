import type { RemoteKey } from "../../types";
import { createCapabilities } from "../shared/capabilities";
import { keymap } from "./keymap";

export const capabilities = createCapabilities({
  supportedKeys: Object.keys(keymap) as RemoteKey[],
  textInput: false,
  textQuickActions: [],
});
