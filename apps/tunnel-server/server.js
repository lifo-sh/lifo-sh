import http from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";

const PORT = 3005;
const pendingRequests = new Map();
let tunnelClient = null;

// Create HTTP server
const server = http.createServer(async (req, res) => {
  // Handle WebSocket upgrade separately
  if (req.headers.upgrade === "websocket") {
    return;
  }

  console.log(`[HTTP] ${req.method} ${req.url}`);

  // Check if tunnel client is connected
  if (!tunnelClient || tunnelClient.readyState !== 1) {
    res.writeHead(503, { "Content-Type": "text/plain" });
    res.end("Tunnel client not connected");
    return;
  }

  // Generate unique request ID
  const requestId = crypto.randomUUID();

  // Read request body
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("base64");

  // Create promise for the response
  const responsePromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error("Request timeout"));
    }, 30000);

    pendingRequests.set(requestId, {
      resolve: (data) => {
        clearTimeout(timeout);
        resolve(data);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });
  });

  // Send request to tunnel client
  const tunnelRequest = {
    type: "request",
    requestId,
    method: req.method,
    url: req.url,
    headers: req.headers,
    body,
  };

  tunnelClient.send(JSON.stringify(tunnelRequest));

  try {
    // Wait for response from client
    const response = await responsePromise;

    // Send response back to original requester
    res.writeHead(response.statusCode, response.headers);
    res.end(Buffer.from(response.body, "base64"));
  } catch (error) {
    console.error("[HTTP] Error:", error.message);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Tunnel error: " + error.message);
  }
});

// Create WebSocket server
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("[WebSocket] Tunnel client connected");
  tunnelClient = ws;

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === "response") {
        const pending = pendingRequests.get(message.requestId);
        if (pending) {
          pendingRequests.delete(message.requestId);
          pending.resolve({
            statusCode: message.statusCode,
            headers: message.headers,
            body: message.body,
          });
        }
      }
    } catch (error) {
      console.error("[WebSocket] Error parsing message:", error);
    }
  });

  ws.on("close", () => {
    console.log("[WebSocket] Tunnel client disconnected");
    if (tunnelClient === ws) {
      tunnelClient = null;
    }

    // Reject all pending requests
    for (const [requestId, pending] of pendingRequests.entries()) {
      pending.reject(new Error("Tunnel client disconnected"));
      pendingRequests.delete(requestId);
    }
  });

  ws.on("error", (error) => {
    console.error("[WebSocket] Error:", error);
  });
});

server.listen(PORT, () => {
  console.log(`Tunnel server listening on port ${PORT}`);
  console.log(`HTTP requests: http://localhost:${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
});
