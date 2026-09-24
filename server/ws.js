'use strict';
const { WebSocketServer } = require('ws');

/** WebSocket hub: pushes snapshots/events to every page, routes control messages back. */
class Hub {
  constructor(server, { onControl, initPayload }) {
    this.wss = new WebSocketServer({ server });
    this.onControl = onControl;
    this.initPayload = initPayload;
    this.wss.on('connection', (ws) => {
      ws.send(JSON.stringify({ type: 'init', ...this.initPayload() }));
      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        const reply = this.onControl(msg, ws);
        if (reply) ws.send(JSON.stringify({ type: 'result', reqId: msg.reqId, ...reply }));
      });
    });
  }

  broadcast(obj) {
    const data = JSON.stringify(obj);
    for (const c of this.wss.clients) if (c.readyState === 1) c.send(data);
  }

  toast(text, kind = 'info', ttl = 4) { this.broadcast({ type: 'toast', text, kind, ttl }); }
  log(text, kind = 'info') { this.broadcast({ type: 'log', text, kind, at: Date.now() }); }
}

module.exports = { Hub };
