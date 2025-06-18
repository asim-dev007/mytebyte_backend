const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static('public'));

const urlMappings = new Map();
const pendingDeliveries = new Map(); 

const STORAGE_FILE = path.join(__dirname, 'url-mappings.json');

async function loadMappings() {
  try {
    const data = await fs.readFile(STORAGE_FILE, 'utf8');
    const mappings = JSON.parse(data);
    Object.entries(mappings).forEach(([key, value]) => {
      urlMappings.set(key, value);
    });
    console.log(`Loaded ${urlMappings.size} URL mappings from storage`);
  } catch (error) {
    console.log('No existing mappings found, starting fresh');
  }
}

// Save mappings to file
async function saveMappings() {
  try {
    const mappingsObj = Object.fromEntries(urlMappings);
    await fs.writeFile(STORAGE_FILE, JSON.stringify(mappingsObj, null, 2));
  } catch (error) {
    console.error('Error saving mappings:', error);
  }
}

function generateShortCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function getBaseUrl(req) {
  const protocol = req.protocol;
  const host = req.get('host');
  return `${protocol}://${host}`;
}

const clients = new Map();

wss.on('connection', (ws, req) => {
  const clientId = crypto.randomUUID();
  clients.set(clientId, {
    socket: ws,
    lastSeen: Date.now()
  });

  console.log(`Client ${clientId} connected`);

  ws.send(JSON.stringify({
    type: 'connection',
    clientId: clientId
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'acknowledgment') {
        const { messageId } = data;
        if (pendingDeliveries.has(messageId)) {
          console.log(`Received acknowledgment for message ${messageId}`);
          clearTimeout(pendingDeliveries.get(messageId).timeout);
          pendingDeliveries.delete(messageId);
        }
      }
    } catch (error) {
      console.error('Error processing client message:', error);
    }
  });

  ws.on('close', () => {
    console.log(`Client ${clientId} disconnected`);
    clients.delete(clientId);
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error for client ${clientId}:`, error);
    clients.delete(clientId);
  });
});

// Function to send message to client with retry logic
function sendToClient(clientId, message, maxRetries = 3) {
  const client = clients.get(clientId);
  if (!client || client.socket.readyState !== WebSocket.OPEN) {
    console.log(`Client ${clientId} not available`);
    return;
  }

  const messageId = crypto.randomUUID();
  const messageWithId = {
    ...message,
    messageId: messageId,
    timestamp: Date.now()
  };

  client.socket.send(JSON.stringify(messageWithId));
  console.log(`Sent message ${messageId} to client ${clientId}`);

  let retryCount = 0;
  const retryTimeout = setTimeout(() => {
    retryDelivery(clientId, messageWithId, retryCount + 1, maxRetries);
  }, 5000);

  pendingDeliveries.set(messageId, {
    clientId,
    message: messageWithId,
    timeout: retryTimeout,
    retryCount: 0,
    maxRetries
  });
}

// Retry delivery function
function retryDelivery(clientId, message, retryCount, maxRetries) {
  if (retryCount >= maxRetries) {
    console.log(`Max retries reached for message ${message.messageId}`);
    pendingDeliveries.delete(message.messageId);
    return;
  }

  const client = clients.get(clientId);
  if (!client || client.socket.readyState !== WebSocket.OPEN) {
    console.log(`Client ${clientId} no longer available, stopping retries`);
    pendingDeliveries.delete(message.messageId);
    return;
  }

  console.log(`Retrying delivery of message ${message.messageId} (attempt ${retryCount + 1})`);
  client.socket.send(JSON.stringify(message));

  const retryTimeout = setTimeout(() => {
    retryDelivery(clientId, message, retryCount + 1, maxRetries);
  }, 5000 * (retryCount + 1)); 

  const pendingDelivery = pendingDeliveries.get(message.messageId);
  if (pendingDelivery) {
    clearTimeout(pendingDelivery.timeout);
    pendingDelivery.timeout = retryTimeout;
    pendingDelivery.retryCount = retryCount;
  }
}

app.post('/url', async (req, res) => {
  const { url, clientId } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  if (!clientId) {
    return res.status(400).json({ error: 'Client ID is required' });
  }

  let shortCode;
  do {
    shortCode = generateShortCode();
  } while (urlMappings.has(shortCode));

  const baseUrl = getBaseUrl(req);
  const shortenedUrl = `${baseUrl}/${shortCode}`;

  urlMappings.set(shortCode, {
    originalUrl: url,
    createdAt: new Date().toISOString(),
    accessCount: 0
  });

  await saveMappings();

  console.log(`Shortened ${url} to ${shortenedUrl}`);

  // Send result to client via WebSocket (not HTTP response)
  sendToClient(clientId, {
    type: 'urlShortened',
    shortenedUrl: shortenedUrl,
    originalUrl: url
  });

  res.status(202).json({ 
    message: 'URL shortening request received and processed',
    status: 'pending_delivery'
  });
});

app.get('/:shortCode', async (req, res) => {
  const { shortCode } = req.params;

  if (!urlMappings.has(shortCode)) {
    return res.status(404).json({ error: 'Shortened URL not found' });
  }

  const mapping = urlMappings.get(shortCode);
  
  mapping.accessCount++;
  urlMappings.set(shortCode, mapping);
  
  await saveMappings();

  res.json({ url: mapping.originalUrl });
});

async function startServer() {
  await loadMappings();
  
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`URL Shortener Server running on port ${PORT}`);
    console.log(`WebSocket server ready for connections`);
  });
}

// Cleanup on exit
process.on('SIGINT', async () => {
  console.log('\nShutting down server...');
  await saveMappings();
  process.exit(0);
});

startServer().catch(console.error);