import http from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";
import os from "os";

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  let port = process.env.PORT || 3005;
  let host = process.env.HOST || '0.0.0.0';
  let tunnelPort = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--port=')) {
      tunnelPort = parseInt(args[i].slice('--port='.length), 10);
    } else if (args[i] === '--port' && args[i + 1]) {
      tunnelPort = parseInt(args[++i], 10);
    } else if (args[i].startsWith('--server-port=')) {
      port = parseInt(args[i].slice('--server-port='.length), 10);
    } else if (args[i] === '--server-port' && args[i + 1]) {
      port = parseInt(args[++i], 10);
    } else if (args[i].startsWith('--host=')) {
      host = args[i].slice('--host='.length);
    } else if (args[i] === '--host' && args[i + 1]) {
      host = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`Lifo Tunnel Server

Usage: node server.js [options]

Options:
  --port <number>        Port to tunnel to inside Lifo (e.g., 5173)
  --server-port <number> Port for tunnel server to listen on (default: 3005)
  --host <address>       Host address to bind to (default: 0.0.0.0)
  -h, --help            Show this help

Examples:
  # Tunnel to port 5173, server listens on 3005
  node server.js --port 5173

  # Custom server port
  node server.js --port 5173 --server-port 8080

Environment Variables:
  PORT         Server listen port (default: 3005)
  HOST         Server bind address (default: 0.0.0.0)
`);
      process.exit(0);
    }
  }

  return { port, host, tunnelPort };
}

const { port: PORT, host: HOST, tunnelPort: TUNNEL_PORT } = parseArgs();

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

  // Prepend tunnel port to URL if specified
  let tunnelUrl = req.url;
  if (TUNNEL_PORT) {
    // Add port prefix for path-based routing: /5173/path
    tunnelUrl = `/${TUNNEL_PORT}${req.url}`;
  }

  // Send request to tunnel client
  const tunnelRequest = {
    type: "request",
    requestId,
    method: req.method,
    url: tunnelUrl,
    headers: req.headers,
    body,
  };

  tunnelClient.send(JSON.stringify(tunnelRequest));

  try {
    // Wait for response from client
    const response = await responsePromise;

    // Log response details
    try {
      console.log(`\n[HTTP] ========== RESPONSE ==========`);
      console.log(`[HTTP] Status: ${response.statusCode}`);
      console.log(`[HTTP] Request: ${req.method} ${req.url}`);
      console.log(`[HTTP] Headers:`, JSON.stringify(response.headers, null, 2));

      if (response.body) {
        const responseBody = Buffer.from(response.body, "base64").toString();
        console.log(`[HTTP] Body Length: ${responseBody.length} bytes`);
        console.log(`[HTTP] Body:`, responseBody.length > 1000 ? responseBody.substring(0, 1000) + '...' : responseBody);
      } else {
        console.log(`[HTTP] Body: <empty>`);
      }
      console.log(`[HTTP] ==============================\n`);
    } catch (logError) {
      console.error(`[HTTP] Logging error:`, logError);
    }

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
  console.log(`\n✓ Tunnel client connected!`);
  if (TUNNEL_PORT) {
    console.log(`  Ready to serve port ${TUNNEL_PORT}\n`);
  } else {
    console.log(`  Ready for path-based routing\n`);
  }
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
    console.log(`\n✗ Tunnel client disconnected`);
    console.log(`  Waiting for reconnection...\n`);
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

server.listen(PORT, HOST, () => {
  const networkInterfaces = os.networkInterfaces();
  const addresses = [];

  for (const iface of Object.values(networkInterfaces)) {
    for (const alias of iface) {
      if (alias.family === 'IPv4' && !alias.internal) {
        addresses.push(alias.address);
      }
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Lifo Tunnel Server`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  if (TUNNEL_PORT) {
    console.log(`✓ Server listening on ${HOST}:${PORT}`);
    console.log(`✓ Tunneling to port ${TUNNEL_PORT}\n`);
    console.log(`Access your app at:`);
    console.log(`  Local:   http://localhost:${PORT}`);
    if (addresses.length > 0) {
      addresses.forEach(addr => {
        console.log(`  Network: http://${addr}:${PORT}`);
      });
    }
    console.log(`\nAll requests will be forwarded to port ${TUNNEL_PORT} inside Lifo`);
  } else {
    console.log(`✓ Server listening on ${HOST}:${PORT}`);
    console.log(`\nAccess your app at:`);
    console.log(`  Local:   http://localhost:${PORT}`);
    if (addresses.length > 0) {
      addresses.forEach(addr => {
        console.log(`  Network: http://${addr}:${PORT}`);
      });
    }
    console.log(`\nPath-based routing mode: http://localhost:${PORT}/PORT/path`);
    console.log(`Example: http://localhost:${PORT}/5173/ → port 5173 inside Lifo`);
  }

  console.log(`\nWebSocket: ws://${HOST}:${PORT}`);
  console.log(`\nWaiting for tunnel client to connect...`);
  console.log(`Run inside Lifo: tunnel\n`);
});
