# URL Shortener Server

A Node.js URL shortener service that uses WebSocket communication for delivering results instead of HTTP responses.

## Features

- **URL Shortening**: Generate 10-character random codes for URLs
- **WebSocket Communication**: Results delivered via WebSocket instead of HTTP response
- **Acknowledgment System**: Clients must acknowledge receipt of shortened URLs
- **Retry Logic**: Server retries delivery if acknowledgment is not received
- **Persistent Storage**: URL mappings saved to file (no database required)
- **Statistics**: Track access counts and view statistics
- **Web Client**: Browser-based client interface included

## Architecture

The server implements a unique communication pattern:

1. Client sends POST request to `/url` with URL and client ID
2. Server responds with HTTP 202 (request accepted)
3. Server generates shortened URL and sends result via WebSocket
4. Client acknowledges receipt via WebSocket
5. If no acknowledgment, server retries with exponential backoff

## API Endpoints

### POST /url
Shorten a URL. Requires WebSocket connection for receiving result.

**Request Body:**
```json
{
  "url": "https://example.com",
  "clientId": "websocket-client-id"
}
```

**Response:**
```json
{
  "message": "URL shortening request received and processed",
  "status": "pending_delivery"
}
```

### GET /:shortCode
Retrieve original URL from shortened code.

**Response:**
```json
{
  "url": "https://example.com"
}
```

### GET /health
Server health and statistics.

### GET /stats
View all shortened URLs and their statistics.

## WebSocket Messages

### Connection Message
Sent when client connects:
```json
{
  "type": "connection",
  "clientId": "uuid"
}
```

### URL Shortened Message
Sent when URL is shortened:
```json
{
  "type": "urlShortened",
  "shortenedUrl": "http://localhost:3000/a2b345w68s",
  "originalUrl": "https://example.com",
  "messageId": "uuid",
  "timestamp": 1234567890
}
```

### Acknowledgment Message
Client must send acknowledgment:
```json
{
  "type": "acknowledgment",
  "messageId": "uuid"
}
```

## Getting Started

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   npm start
   ```
   
   Or for development with auto-restart:
   ```bash
   npm run dev
   ```

3. **Open web client:**
   Navigate to `http://localhost:3000` in your browser

4. **Test with command line client:**
   ```bash
   node client-example.js
   ```

## Usage Examples

### Web Browser Client
1. Open `http://localhost:3000`
2. Wait for WebSocket connection
3. Enter URL to shorten
4. Receive shortened URL via WebSocket

### Programmatic Client
```javascript
const URLShortenerClient = require('./client-example');

const client = new URLShortenerClient();
await client.connect();
await client.shortenUrl('https://example.com');
```

### cURL Testing
```bash
# This will return 202 but result comes via WebSocket
curl -X POST http://localhost:3000/url \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","clientId":"test-client"}'

# Retrieve original URL
curl http://localhost:3000/a2b345w68s
```

## Configuration

- **Port**: Set via `PORT` environment variable (default: 3000)
- **Storage**: URL mappings saved to `url-mappings.json`
- **Retry Logic**: 3 retries with exponential backoff (5s, 10s, 15s)

## File Structure

```
├── server.js              # Main server implementation
├── client-example.js      # Example Node.js client
├── public/
│   └── index.html         # Web client interface
├── url-mappings.json      # Persistent storage (created automatically)
└── README.md             # This file
```

## Error Handling

- **Connection Issues**: Server retries delivery up to 3 times
- **Invalid URLs**: HTTP 400 error response
- **Missing Short Codes**: HTTP 404 error response
- **WebSocket Disconnections**: Automatic reconnection attempts

## Security Considerations

- No authentication implemented (add as needed)
- URL validation should be enhanced for production
- Rate limiting not implemented
- CORS headers may need adjustment for production

## Testing

The server includes several ways to test functionality:

1. **Web Interface**: Open browser to `http://localhost:3000`
2. **Command Line Client**: Run `node client-example.js`
3. **Manual cURL**: Use cURL commands (WebSocket results won't be visible)
4. **Health Check**: `curl http://localhost:3000/health`
5. **Statistics**: `curl http://localhost:3000/stats`