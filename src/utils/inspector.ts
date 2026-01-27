import { createWebSocketInspector } from "@statelyai/inspect";

const INSPECTOR_ENABLED = process.env.XSTATE_INSPECT === "true";

function createInspector() {
  const inspector = createWebSocketInspector({
    url: process.env.XSTATE_SERVER || "ws://localhost:8080",
  });
  inspector.start();
  return inspector;
}

export const inspector = INSPECTOR_ENABLED ? createInspector() : null;
