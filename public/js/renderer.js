// Shared canvas renderer for the overlay and the control panel.
// Draws from the latest server snapshot with light interpolation for smooth movement.

const ENEMY_SIZE = { goblin: 34, wolf: 36, orc: 42, knight: 44, tank: 52, boss: 70 };
const PROJ_SIZE = { arrow: 22, shell: 16, ice: 18 };

export class Renderer {
  constructor(canvas, sprites, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sprites = sprites;
    this.opts = { showGrid: false, showHud: true, ...opts };
    this.map = null;
    this.towerDefs = {};
    this.enemyDefs = {};
    this.state = null;
    this.prev = null;
    this.stateAt = 0;
    this.toasts = [];
    this.hover = null;      // { col, row } from control panel
    this.ghost = null;      // { type, col, row, ok } placement preview
    this.selected = null;   // tower id
    this.pathCanvas = null;
  }

  init({ map, towers, enemies }) {
    this.map = map;
    this.towerDefs = towers;
    this.enemyDefs = enemies;
    this.pathSet = new Set(map.pathCells.map(([c, r]) => `${c},${r}`));
    this.canvas.width = map.cols * map.cellSize;
    this.canvas.height = map.rows * map.cellSize;
    this.pathCanvas = null;
  }

  setState(s) {
    this.prev = this.state;
    this.state = s;
    this.stateAt = performance.now();
  }

  addToast(t) { this.toasts.push({ ...t, at: performance.now() }); }

  // ---- helpers --------------------------------------------------------------

  cellAt(px, py) {
    if (!this.map) return null;
    const rect = this.canvas.getBoundingClientRect();
    const sx = this.canvas.width / rect.width, sy = this.canvas.height / rect.height;
    const x = (px - rect.left) * sx, y = (py - rect.top) * sy;
    const col = Math.floor(x / this.map.cellSize), row = Math.floor(y / this.map.cellSize);
    if (col < 0 || row < 0 || col >= this.map.cols || row >= this.map.rows) return null;
    return { col, row };
  }

  isBuildable(col, row) {
    if (!this.map) return false;
    if (this.pathSet.has(`${col},${row}`)) return false;
    if (this.map.blocked.some(([c, r]) => c === col && r === row)) return false;
    if (this.state && this.state.towers.some(t => t.c === col && t.r === row)) return false;
    return true;
  }

  towerAt(col, row) {
    return this.state ? this.state.towers.find(t => t.c === col && t.r === row) : null;
  }

  // ---- drawing --------------------------------------------------------------

  _buildPathLayer() {
    const { cols, rows, cellSize: cs } = this.map;
    const c = document.createElement('canvas');
    c.width = cols * cs; c.height = rows * cs;
    const ctx = c.getContext('2d');
    const alpha = this.map.overlay?.pathOpacity ?? 0.6;
    for (const [col, row] of this.map.pathCells) {
      const x = col * cs, y = row * cs;
      if (!this.sprites.tile(ctx, 'path', x, y, cs, alpha)) {
        ctx.fillStyle = `rgba(120, 100, 70, ${alpha})`;
        ctx.fillRect(x, y, cs, cs);
        ctx.strokeStyle = `rgba(60, 45, 30, ${alpha})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, cs - 2, cs - 2);
      }
    }
    // entry / exit markers
    const wp = this.map.waypoints;
    const mark = (p, text, color) => {
      ctx.fillStyle = color; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(p.x, p.y, cs * 0.35, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `bold ${cs * 0.35}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, p.x, p.y); ctx.globalAlpha = 1;
    };
    const clamp = (p) => ({ x: Math.min(Math.max(p.x, cs * 0.5), c.width - cs * 0.5), y: Math.min(Math.max(p.y, cs * 0.5), c.height - cs * 0.5) });
    mark(clamp(wp[0]), 'IN', '#43a047');
    mark(clamp(wp[wp.length - 1]), 'OUT', '#e53935');
    this.pathCanvas = c;
  }

  draw() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!this.map) return;
    if (!this.pathCanvas) this._buildPathLayer();
    ctx.drawImage(this.pathCanvas, 0, 0);
    if (this.opts.showGrid) this._drawGrid();
    if (!this.state) return;

    // interpolation factor between prev and current snapshot (snapshots ~50ms apart)
    const t = Math.min(1, (performance.now() - this.stateAt) / 50);

    this._drawTowers();
    this._drawGhost();
    this._drawEnemies(t);
    this._drawProjectiles(t);
    this._drawFloats();
    if (this.opts.showHud) this._drawHud();
    this._drawToasts();
    if (this.state.gameOver) this._drawGameOver();
  }

  _drawGrid() {
    const { ctx, map } = this;
    const cs = map.cellSize;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= map.cols; c++) { ctx.beginPath(); ctx.moveTo(c * cs, 0); ctx.lineTo(c * cs, map.rows * cs); ctx.stroke(); }
    for (let r = 0; r <= map.rows; r++) { ctx.beginPath(); ctx.moveTo(0, r * cs); ctx.lineTo(map.cols * cs, r * cs); ctx.stroke(); }
    if (this.hover) {
      const ok = this.isBuildable(this.hover.col, this.hover.row);
      ctx.fillStyle = ok ? 'rgba(76,175,80,0.25)' : 'rgba(229,57,53,0.25)';
      ctx.fillRect(this.hover.col * cs, this.hover.row * cs, cs, cs);
    }
    ctx.restore();
  }

  _lerpEnemy(e, t) {
    if (!this.prev) return e;
    const p = this.prev.enemies.find(x => x.id === e.id);
    if (!p) return e;
    return { ...e, x: p.x + (e.x - p.x) * t, y: p.y + (e.y - p.y) * t };
  }

  _drawTowers() {
    const { ctx, map, state } = this;
    const cs = map.cellSize;
    for (const tw of state.towers) {
      const def = this.towerDefs[tw.t];
      const x = (tw.c + 0.5) * cs, y = (tw.r + 0.5) * cs;
      if (this.selected === tw.id) {
        const stats = def.levels[tw.l];
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, stats.range, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      // base
      if (!this.sprites.tile(ctx, 'towerBase', tw.c * cs + 4, tw.r * cs + 4, cs - 8)) {
        ctx.fillStyle = 'rgba(40,40,40,0.85)';
        ctx.fillRect(tw.c * cs + 6, tw.r * cs + 6, cs - 12, cs - 12);
      }
      // turret
      if (!this.sprites.draw(ctx, `tower_${tw.t}`, x, y, tw.a, cs * 0.85)) {
        ctx.save();
        ctx.translate(x, y); ctx.rotate(tw.a);
        ctx.fillStyle = def.color;
        ctx.beginPath(); ctx.arc(0, 0, cs * 0.3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#222';
        ctx.fillRect(0, -5, cs * 0.42, 10);
        ctx.restore();
      }
      // level pips
      ctx.fillStyle = '#ffd54f';
      for (let i = 0; i <= tw.l; i++) {
        ctx.beginPath(); ctx.arc(tw.c * cs + 10 + i * 10, tw.r * cs + cs - 9, 3.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  _drawGhost() {
    if (!this.ghost) return;
    const { ctx, map } = this;
    const cs = map.cellSize;
    const def = this.towerDefs[this.ghost.type];
    if (!def) return;
    const x = (this.ghost.col + 0.5) * cs, y = (this.ghost.row + 0.5) * cs;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = this.ghost.ok ? 'rgba(76,175,80,0.35)' : 'rgba(229,57,53,0.35)';
    ctx.beginPath(); ctx.arc(x, y, def.levels[0].range, 0, Math.PI * 2); ctx.fill();
    this.sprites.tile(ctx, 'towerBase', this.ghost.col * cs + 4, this.ghost.row * cs + 4, cs - 8);
    if (!this.sprites.draw(ctx, `tower_${this.ghost.type}`, x, y, -Math.PI / 2, cs * 0.85)) {
      ctx.fillStyle = def.color; ctx.beginPath(); ctx.arc(x, y, cs * 0.3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  _drawEnemies(t) {
    const { ctx, state } = this;
    const cs = this.map.cellSize;
    for (const raw of state.enemies) {
      const e = this._lerpEnemy(raw, t);
      const def = this.enemyDefs[e.t] || {};
      const size = ENEMY_SIZE[e.t] || 40;
      if (!this.sprites.draw(ctx, `enemy_${e.t}`, e.x, e.y, e.a, size)) {
        ctx.save();
        ctx.translate(e.x, e.y); ctx.rotate(e.a);
        ctx.fillStyle = def.color || '#fff';
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, size / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath(); ctx.moveTo(size / 2, 0); ctx.lineTo(size / 5, -size / 5); ctx.lineTo(size / 5, size / 5); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      if (e.s) { // slowed tint
        ctx.save(); ctx.globalAlpha = 0.45; ctx.fillStyle = '#4fc3f7';
        ctx.beginPath(); ctx.arc(e.x, e.y, size / 2 + 2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
      // health bar
      const bw = Math.max(30, size), bh = 5;
      const bx = e.x - bw / 2, by = e.y - size / 2 - 10;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      ctx.fillStyle = e.hp > 0.5 ? '#66bb6a' : e.hp > 0.25 ? '#ffa726' : '#ef5350';
      ctx.fillRect(bx, by, bw * e.hp, bh);
      // owner label
      if (e.o) {
        ctx.font = `bold ${Math.round(cs * 0.24)}px "Segoe UI", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.fillStyle = '#fff';
        ctx.strokeText(e.o, e.x, by - 3); ctx.fillText(e.o, e.x, by - 3);
      }
    }
  }

  _drawProjectiles(t) {
    const { ctx, state } = this;
    for (const p of state.projectiles) {
      if (p.k === 'bolt') {
        ctx.save();
        ctx.strokeStyle = '#e1bee7'; ctx.lineWidth = 3; ctx.shadowColor = '#ce93d8'; ctx.shadowBlur = 12;
        ctx.beginPath();
        p.pts.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y));
        ctx.stroke();
        ctx.restore();
        continue;
      }
      let x = p.x, y = p.y;
      if (this.prev) {
        const q = this.prev.projectiles.find(z => z.id === p.id);
        if (q && q.k !== 'bolt') { x = q.x + (p.x - q.x) * t; y = q.y + (p.y - q.y) * t; }
      }
      if (!this.sprites.draw(ctx, `proj_${p.k}`, x, y, p.a, PROJ_SIZE[p.k] || 16)) {
        ctx.save();
        ctx.translate(x, y); ctx.rotate(p.a);
        ctx.fillStyle = p.k === 'shell' ? '#333' : p.k === 'ice' ? '#81d4fa' : '#ffe082';
        if (p.k === 'shell') { ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill(); }
        else { ctx.fillRect(-8, -2, 16, 4); }
        ctx.restore();
      }
    }
  }

  _drawFloats() {
    const { ctx, state } = this;
    ctx.font = 'bold 20px "Segoe UI", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const f of state.floats) {
      const a = 1 - f.age / 1.2;
      ctx.globalAlpha = Math.max(0, a);
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.fillStyle = f.color;
      const y = f.y - f.age * 40;
      ctx.strokeText(f.text, f.x, y); ctx.fillText(f.text, f.x, y);
    }
    ctx.globalAlpha = 1;
  }

  _drawHud() {
    const { ctx, state } = this;
    const pad = 14;
    const lines = [
      { icon: '❤', text: `${state.lives}`, color: '#ef5350' },
      { icon: '⛃', text: `${state.gold}`, color: '#ffd54f' },
      { icon: '☠', text: `${state.kills}`, color: '#fff' },
    ];
    ctx.save();
    ctx.font = 'bold 26px "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    let x = pad;
    const y = this.canvas.height - 30;
    const h = 44;
    let total = 0;
    for (const l of lines) total += ctx.measureText(`${l.icon} ${l.text}`).width + 28;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath(); ctx.roundRect(pad - 8, y - h / 2, total + 8, h, 10); ctx.fill();
    for (const l of lines) {
      ctx.fillStyle = l.color;
      ctx.fillText(`${l.icon} ${l.text}`, x, y);
      x += ctx.measureText(`${l.icon} ${l.text}`).width + 28;
    }
    if (state.paused) {
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = 'bold 48px "Segoe UI", sans-serif';
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText('PAUSED', this.canvas.width / 2, 60); ctx.fillText('PAUSED', this.canvas.width / 2, 60);
    }
    ctx.restore();
  }

  _drawToasts() {
    const { ctx } = this;
    const now = performance.now();
    this.toasts = this.toasts.filter(t => now - t.at < t.ttl * 1000);
    ctx.save();
    ctx.font = 'bold 24px "Segoe UI", sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    let y = 34;
    const colors = { spawn: '#ff8a65', buff: '#ba68c8', reply: '#90caf9', gameover: '#ef5350', info: '#fff' };
    for (const t of this.toasts.slice(-6)) {
      const age = (now - t.at) / 1000;
      const fade = Math.min(1, age * 4, (t.ttl - age) * 2);
      ctx.globalAlpha = Math.max(0, fade);
      const w = ctx.measureText(t.text).width + 24;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath(); ctx.roundRect(this.canvas.width - w - 14, y - 20, w, 40, 8); ctx.fill();
      ctx.fillStyle = colors[t.kind] || '#fff';
      ctx.fillText(t.text, this.canvas.width - 26, y);
      y += 48;
    }
    ctx.restore();
  }

  _drawGameOver() {
    const { ctx, state } = this;
    const cx = this.canvas.width / 2, cy = this.canvas.height / 2;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath(); ctx.roundRect(cx - 300, cy - 150, 600, 300, 16); ctx.fill();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ef5350'; ctx.font = 'bold 56px "Segoe UI", sans-serif';
    ctx.fillText('CHAT WINS', cx, cy - 95);
    ctx.fillStyle = '#fff'; ctx.font = '24px "Segoe UI", sans-serif';
    ctx.fillText(`Survived ${Math.floor(state.elapsed / 60)}m ${state.elapsed % 60}s · ${state.kills} kills`, cx, cy - 50);
    ctx.font = 'bold 22px "Segoe UI", sans-serif'; ctx.fillStyle = '#ffd54f';
    ctx.fillText('Top leakers', cx, cy - 10);
    ctx.font = '22px "Segoe UI", sans-serif'; ctx.fillStyle = '#fff';
    state.leaders.slice(0, 4).forEach((l, i) => ctx.fillText(`${i + 1}. ${l.name} — ${l.lives} lives`, cx, cy + 22 + i * 28));
    ctx.fillStyle = '#bbb'; ctx.font = '18px "Segoe UI", sans-serif';
    ctx.fillText(`New round in ${Math.ceil(state.resetIn)}s`, cx, cy + 130);
    ctx.restore();
  }
}
