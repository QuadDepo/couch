// Client tracking
let nodeClient: unknown = null;
let bridgeClient: unknown = null;

// Read bridge HTML
const bridgeHtml = await Bun.file(new URL("./bridge.html", import.meta.url)).text();

function identifyClient(ws: unknown): string {
  if (ws === bridgeClient) return "bridge";
  if (ws === nodeClient) return "node";
  return "unknown";
}

Bun.serve({
  port: 8080,
  fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (server.upgrade(req)) {
      return undefined;
    }

    // Serve bridge HTML
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
      let data: { type?: string };

      try {
        data = JSON.parse(msg);
      } catch {
        console.warn(`[!] Non-JSON message from ${identifyClient(ws)}, closing`);
        ws.close(1003, "Unsupported format");
        return;
      }

      // Bridge client identifying itself
      if (data.type === "BRIDGE_CONNECT") {
        if (bridgeClient && bridgeClient !== ws) {
          console.log(`[~] Replacing previous bridge connection`);
          (bridgeClient as { close: (code: number, reason: string) => void }).close(
            1001,
            "New bridge connected",
          );
        }
        bridgeClient = ws;
        console.log(`[+] Bridge connected`);
        return;
      }

      // Messages from node client -> forward to bridge
      if (ws === nodeClient) {
        if (bridgeClient) {
          (bridgeClient as { send: (m: string) => void }).send(msg);
        }
        return;
      }

      // Messages from bridge (ignore)
      if (ws === bridgeClient) {
        return;
      }

      // New node client
      if (!nodeClient) {
        nodeClient = ws;
        console.log(`[+] Node client connected`);

        // Log event type
        if (data.type) {
          console.log(`[>] ${data.type}`);
        }

        // Forward to bridge if connected
        if (bridgeClient) {
          (bridgeClient as { send: (m: string) => void }).send(msg);
        }
      } else if (ws !== nodeClient) {
        // Forward subsequent messages from node client
        nodeClient = ws;
        if (data.type) {
          console.log(`[>] ${data.type}`);
        }
        if (bridgeClient) {
          (bridgeClient as { send: (m: string) => void }).send(msg);
        }
      }
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
