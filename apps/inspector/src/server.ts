import type { ServerWebSocket } from "bun";

type Client = ServerWebSocket<undefined>;

let nodeClient: Client | null = null;
let bridgeClient: Client | null = null;

const bridgeHtml = await Bun.file(new URL("./bridge.html", import.meta.url)).text();

function identifyClient(ws: Client): string {
  if (ws === bridgeClient) return "bridge";
  if (ws === nodeClient) return "node";
  return "unknown";
}

Bun.serve({
  port: 8080,
  fetch(req, server) {
    const url = new URL(req.url);

    if (server.upgrade(req)) {
      return undefined;
    }

    if (url.pathname === "/" || url.pathname === "/bridge") {
      return new Response(bridgeHtml, {
        headers: { "Content-Type": "text/html" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
  websocket: {
    open() {
      console.log(`[+] New connection`);
    },
    message(ws, message) {
      const msg = String(message);

      // Network boundary: JSON.parse can yield any valid JSON (including null),
      // so validate the shape before routing on `type`.
      let parsed: unknown;
      try {
        parsed = JSON.parse(msg);
      } catch {
        console.warn(`[!] Non-JSON message from ${identifyClient(ws)}, closing`);
        ws.close(1003, "Unsupported format");
        return;
      }

      if (typeof parsed !== "object" || parsed === null) {
        console.warn(`[!] Non-object message from ${identifyClient(ws)}, closing`);
        ws.close(1003, "Unsupported format");
        return;
      }

      const rawType = (parsed as Record<string, unknown>).type;
      if (rawType !== undefined && typeof rawType !== "string") {
        console.warn(`[!] Message with non-string "type" from ${identifyClient(ws)}, closing`);
        ws.close(1003, "Unsupported format");
        return;
      }
      const type = rawType;

      if (type === "BRIDGE_CONNECT") {
        if (bridgeClient && bridgeClient !== ws) {
          console.log(`[~] Replacing previous bridge connection`);
          bridgeClient.close(1001, "New bridge connected");
        }
        bridgeClient = ws;
        console.log(`[+] Bridge connected`);
        return;
      }

      // Node -> bridge relay; messages coming back from the bridge are ignored.
      if (ws === nodeClient) {
        bridgeClient?.send(msg);
        return;
      }
      if (ws === bridgeClient) {
        return;
      }

      // Any other client becomes the node client; the most recent one wins.
      console.log(nodeClient ? `[~] Replacing node client` : `[+] Node client connected`);
      nodeClient = ws;
      if (type) {
        console.log(`[>] ${type}`);
      }
      bridgeClient?.send(msg);
    },
    close(ws) {
      const clientType = identifyClient(ws);
      console.log(`[-] ${clientType} disconnected`);

      if (ws === bridgeClient) bridgeClient = null;
      if (ws === nodeClient) nodeClient = null;
    },
  },
});

console.log(`
XState Inspector Bridge Server
==============================
1. Open http://localhost:8080 in your browser
2. Allow the pop-up for stately.ai/inspect
3. Run your app: XSTATE_INSPECT=true bun dev
`);
