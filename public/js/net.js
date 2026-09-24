// WebSocket client with auto-reconnect and request/response helper.
export class Net {
  constructor() {
    this.handlers = {};
    this.pending = new Map();
    this.reqId = 1;
    this.connected = false;
    this._connect();
  }

  on(type, fn) { (this.handlers[type] ||= []).push(fn); return this; }

  _emit(type, msg) { for (const fn of this.handlers[type] || []) fn(msg); }

  _connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}`);
    this.ws = ws;
    ws.onopen = () => { this.connected = true; this._emit('open'); };
    ws.onclose = () => {
      this.connected = false; this._emit('close');
      setTimeout(() => this._connect(), 1500);
    };
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'result' && this.pending.has(msg.reqId)) {
        this.pending.get(msg.reqId)(msg); this.pending.delete(msg.reqId); return;
      }
      this._emit(msg.type, msg);
    };
  }

  /** Send a control message; resolves with the server's result. */
  send(msg) {
    return new Promise((resolve) => {
      if (!this.connected) return resolve({ ok: false, error: 'Not connected' });
      const reqId = this.reqId++;
      this.pending.set(reqId, resolve);
      this.ws.send(JSON.stringify({ ...msg, reqId }));
      setTimeout(() => { if (this.pending.has(reqId)) { this.pending.delete(reqId); resolve({ ok: false, error: 'Timeout' }); } }, 3000);
    });
  }
}
