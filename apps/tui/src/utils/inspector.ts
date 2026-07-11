import type { createWebSocketInspector } from "@statelyai/inspect";

const INSPECTOR_ENABLED = process.env.XSTATE_INSPECT === "true";

interface InspectorHandle {
  inspect: ReturnType<typeof createWebSocketInspector>["inspect"];
}

async function createInspector(): Promise<InspectorHandle> {
  // Dev-only tooling: import lazily so @statelyai/inspect stays out of the
  // production graph and is only pulled in when the gate is enabled.
  const { createWebSocketInspector } = await import("@statelyai/inspect");
  const inspector = createWebSocketInspector({
    url: process.env.XSTATE_SERVER || "ws://localhost:8080",
  });
  inspector.start();
  return inspector;
}

export const inspector: InspectorHandle | null = INSPECTOR_ENABLED ? await createInspector() : null;
