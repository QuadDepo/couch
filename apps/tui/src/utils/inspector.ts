import { createWebSocketInspector } from "@statelyai/inspect";

const INSPECTOR_ENABLED = process.env.XSTATE_INSPECT === "true";

interface InspectorHandle {
  inspect: ReturnType<typeof createWebSocketInspector>["inspect"];
}

function createInspector(): InspectorHandle {
  const inspector = createWebSocketInspector({
    url: process.env.XSTATE_SERVER || "ws://localhost:8080",
  });
  inspector.start();
  return inspector;
}

export const inspector: InspectorHandle | null = INSPECTOR_ENABLED ? createInspector() : null;
