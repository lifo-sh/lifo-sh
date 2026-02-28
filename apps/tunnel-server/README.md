# Lifo Tunnel Server

An ngrok-like tunneling server that enables HTTP requests from the host machine to be forwarded to services running inside the Lifo environment.

## Architecture

```
Host Machine (Port 3001)
         ↓
  Tunnel Server
         ↓
    WebSocket
         ↓
  Tunnel Command (inside Lifo)
         ↓
  Virtual HTTP Servers (multiple ports)
```

## Components

### 1. Tunnel Server (`tunnel-server/`)

Runs on the host machine on port 3001. It:

- Accepts HTTP requests on port 3001
- Maintains WebSocket connections with tunnel clients
- Forwards HTTP requests through WebSocket to connected clients
- Returns responses back to the original HTTP requesters

### 2. Tunnel Command (built into Lifo)

Runs inside the Lifo environment. It:

- Connects to the tunnel server via WebSocket
- Discovers all HTTP servers in Lifo's virtual port registry
- Receives HTTP requests from the tunnel server
- Routes them to the appropriate virtual server based on port
- Sends responses back through the WebSocket

## Usage

### 1. Start the Tunnel Server (on host machine)

```bash
cd tunnel-server
npm install
npm start
```

The server will start on port 3005.

### 2. Run the Tunnel Command (inside Lifo)

From your Lifo CLI, run:

```bash
lifo
> tunnel --server=ws://localhost:3005
```

Or simply:

```bash
lifo
> tunnel
```

The tunnel command will:

- Connect to the tunnel server at ws://localhost:3005 (default)
- Automatically discover all HTTP servers running in Lifo
- Forward external requests to the appropriate internal server

### 3. Access the Tunneled Services

The tunnel uses **path-based routing** to access different ports. Use the format: `/PORT/path`

Examples:

```bash
# Access port 8080
curl http://localhost:3001/8080/

# Access port 3000 with a path
curl http://localhost:3001/3000/api/users

# Access port 8080 with query parameters
curl http://localhost:3001/8080/search?q=test
```

Path-based routing format:

- `http://localhost:3001/8080/` → Routes to port 8080 inside Lifo
- `http://localhost:3001/3000/api/users` → Routes to port 3000, path `/api/users`
- First path segment is always the port number
- Everything after the port is the actual path sent to the internal server

## Testing

### Example: Single Server

```bash
# Terminal 1: Start tunnel server
cd apps/tunnel-server
npm start

# Terminal 2: Start Lifo and create HTTP server
lifo
> node -e "require('http').createServer((req,res) => res.end('Hello')).listen(8080)"
> tunnel

# Terminal 3: Test the tunnel
curl http://localhost:3001/8080/
# Output: Hello
```

### Example: Multiple Servers

```bash
# In Lifo:
> node -e "require('http').createServer((req,res) => res.end('API')).listen(3000)"
> node -e "require('http').createServer((req,res) => res.end('Web')).listen(8080)"
> tunnel

# From host machine:
curl http://localhost:3001/3000/  # Output: API
curl http://localhost:3001/8080/  # Output: Web
```

## Features

- Real-time request/response tunneling
- WebSocket-based communication
- Automatic reconnection if tunnel client disconnects
- Support for all HTTP methods (GET, POST, PUT, DELETE, etc.)
- Headers and body forwarding
- Base64 encoding for binary data

## Ports

- **3001**: Tunnel server HTTP and WebSocket (host machine)
- **Any port**: Virtual HTTP servers inside Lifo (accessed via `/PORT/path` routing)

## Notes

- The tunnel server must be running before starting the tunnel command
- If the tunnel disconnects, it will automatically attempt to reconnect after 5 seconds
- All request/response data is logged to the console for debugging
- The tunnel automatically discovers all HTTP servers in Lifo's virtual environment
- Use `tunnel --help` for more options
