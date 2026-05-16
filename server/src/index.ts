import { WebSocketServer, WebSocket } from 'ws';
import { decode } from '@phonesaber/protocol';

const PORT = 8080;

const wss = new WebSocketServer({ port: PORT, host: '0.0.0.0' });

const connections = new Set<WebSocket>();
let inFlight = 0;
let lastReport = Date.now();

setInterval(() => {
  const now = Date.now();
  const elapsed = (now - lastReport) / 1000;
  const rate = inFlight / elapsed;
  console.log(`[server] ${rate.toFixed(1)} msg/s • ${connections.size} clients`);
  inFlight = 0;
  lastReport = now;
}, 1000);

wss.on('connection', (ws, req) => {
  connections.add(ws);
  console.log(`[server] connect ${req.socket.remoteAddress} (${connections.size} total)`);

  ws.on('message', (data, isBinary) => {
    inFlight++;
    const text = isBinary ? null : data.toString();
    if (text === null) return;
    // Lightweight validation so junk doesn't get fanned out — but stay fast,
    // we only check first frame parses, then forward bytes.
    if (decode(text) === null) {
      console.warn(`[server] dropped unparseable frame: ${text.slice(0, 64)}`);
      return;
    }
    for (const peer of connections) {
      if (peer !== ws && peer.readyState === WebSocket.OPEN) {
        peer.send(text);
      }
    }
  });

  ws.on('close', () => {
    connections.delete(ws);
    console.log(`[server] disconnect (${connections.size} total)`);
  });
});

console.log(`[server] listening on ws://0.0.0.0:${PORT}`);
