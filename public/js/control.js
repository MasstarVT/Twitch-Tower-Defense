import { Net } from './net.js';
import { Sprites } from './sprites.js';
import { Renderer } from './renderer.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const sprites = new Sprites();
const renderer = new Renderer(canvas, sprites, { showGrid: true, showHud: false });
const net = new Net();

let init = null;
let buildType = null;
let state = null;

const TOWER_DESC = { archer: 'Fast single target', cannon: 'Slow, splash damage', frost: 'Slows enemies', tesla: 'Chains between enemies' };

// ---- connection -------------------------------------------------------------
net.on('open', () => $('conn').classList.add('on'));
net.on('close', () => $('conn').classList.remove('on'));
net.on('init', (msg) => { init = msg; renderer.init(msg); buildButtons(); });
net.on('state', (s) => { state = s; renderer.setState(s); updateStats(); updateSelected(); });
net.on('toast', (t) => renderer.addToast(t));
net.on('log', (l) => addLog(l));

sprites.load().then(() => { renderer.pathCanvas = null; });

// ---- build bar --------------------------------------------------------------
function buildButtons() {
  const box = $('build');
  box.innerHTML = '';
  for (const [key, def] of Object.entries(init.towers)) {
    const b = document.createElement('button');
    b.dataset.type = key;
    b.innerHTML = `<span class="name">${def.name}</span><span class="cost">${def.cost}g</span><span class="desc">${TOWER_DESC[key] || ''}</span>`;
    b.onclick = () => setBuild(buildType === key ? null : key);
    box.appendChild(b);
  }
}

function setBuild(type) {
  buildType = type;
  renderer.selected = null;
  for (const b of $('build').children) b.classList.toggle('active', b.dataset.type === type);
  if (!type) renderer.ghost = null;
}

function updateStats() {
  $('lives').textContent = state.lives;
  $('gold').textContent = state.gold;
  $('kills').textContent = state.kills;
  $('elapsed').textContent = `${Math.floor(state.elapsed / 60)}:${String(state.elapsed % 60).padStart(2, '0')}`;
  $('pause').textContent = state.paused ? 'Resume' : 'Pause';
  for (const b of $('build').children) b.disabled = state.gold < init.towers[b.dataset.type].cost;
  const ol = $('leaders');
  ol.innerHTML = state.leaders.map(l => `<li>${escapeHtml(l.name)} — ${l.lives}</li>`).join('') || '<li class="muted">none yet</li>';
}

function updateSelected() {
  const box = $('selected');
  const tw = state.towers.find(t => t.id === renderer.selected);
  if (!tw) { renderer.selected = null; box.innerHTML = '<p class="muted">Nothing selected</p>'; return; }
  const def = init.towers[tw.t];
  const stats = def.levels[tw.l];
  const next = def.levels[tw.l + 1];
  const refund = Math.round(tw.inv * init.streamer.sellRefund);
  box.innerHTML = `
    <div class="row"><b>${def.name}</b><span>Level ${tw.l + 1}/${def.levels.length}</span></div>
    <div class="row"><span>Damage</span><span>${stats.damage}${next ? ` → ${next.damage}` : ''}</span></div>
    <div class="row"><span>Range</span><span>${stats.range}${next ? ` → ${next.range}` : ''}</span></div>
    <div class="row"><span>Fire rate</span><span>${stats.fireRate}/s${next ? ` → ${next.fireRate}/s` : ''}</span></div>
    <div class="row"><span>Kills</span><span>${tw.k}</span></div>
    <div class="buttons">
      <button id="upg" ${!next || state.gold < stats.upgradeCost ? 'disabled' : ''}>${next ? `Upgrade (${stats.upgradeCost}g)` : 'Max level'}</button>
      <button id="sell" class="danger">Sell (+${refund}g)</button>
    </div>`;
  $('upg').onclick = () => net.send({ type: 'upgrade', id: tw.id }).then(showResult);
  $('sell').onclick = () => net.send({ type: 'sell', id: tw.id }).then((r) => { showResult(r); renderer.selected = null; });
}

function showResult(r) {
  if (r && r.ok === false && r.error) renderer.addToast({ text: r.error, kind: 'info', ttl: 2 });
}

// ---- canvas interaction -----------------------------------------------------
canvas.addEventListener('mousemove', (ev) => {
  const cell = renderer.cellAt(ev.clientX, ev.clientY);
  renderer.hover = cell;
  renderer.ghost = buildType && cell ? { type: buildType, ...cell, ok: renderer.isBuildable(cell.col, cell.row) } : null;
});
canvas.addEventListener('mouseleave', () => { renderer.hover = null; renderer.ghost = null; });
canvas.addEventListener('contextmenu', (ev) => { ev.preventDefault(); setBuild(null); renderer.selected = null; updateSelected(); });
canvas.addEventListener('click', async (ev) => {
  const cell = renderer.cellAt(ev.clientX, ev.clientY);
  if (!cell) return;
  const existing = renderer.towerAt(cell.col, cell.row);
  if (buildType) {
    if (existing) { setBuild(null); renderer.selected = existing.id; updateSelected(); return; }
    const r = await net.send({ type: 'build', tower: buildType, col: cell.col, row: cell.row });
    showResult(r);
    if (r.ok && !ev.shiftKey) setBuild(null);
    return;
  }
  renderer.selected = existing ? existing.id : null;
  updateSelected();
});
window.addEventListener('keydown', (ev) => {
  if (ev.target.tagName === 'INPUT') return;
  if (ev.key === 'Escape') { setBuild(null); renderer.selected = null; updateSelected(); }
  const keys = { 1: 'archer', 2: 'cannon', 3: 'frost', 4: 'tesla' };
  if (keys[ev.key]) setBuild(keys[ev.key]);
});

// ---- header buttons ---------------------------------------------------------
$('pause').onclick = () => net.send({ type: 'pause', paused: !state.paused });
$('reset').onclick = () => { if (confirm('Reset the current game?')) net.send({ type: 'reset' }); };

// ---- dev chat ---------------------------------------------------------------
$('devchat').addEventListener('submit', (ev) => {
  ev.preventDefault();
  sendChat($('devmsg').value);
  $('devmsg').value = '';
});
for (const b of document.querySelectorAll('.quick button')) b.onclick = () => sendChat(b.dataset.msg);

function sendChat(message) {
  if (!message) return;
  const user = $('devuser').value || 'Viewer1';
  if (message === '!rich') {
    // dev helper: spam cheap messages won't work due to cooldown, so ask server for a grant
    fetch('/dev/grant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user, coins: 500 }) });
    return;
  }
  net.send({ type: 'chat', user, message });
  addLog({ text: `${user}: ${message}`, kind: 'chat', at: Date.now() });
}

function addLog(l) {
  const box = $('log');
  const d = document.createElement('div');
  d.className = l.kind || '';
  const t = new Date(l.at || Date.now());
  d.textContent = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')} ${l.text}`;
  box.appendChild(d);
  while (box.children.length > 200) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---- render loop ------------------------------------------------------------
function frame() { renderer.draw(); requestAnimationFrame(frame); }
frame();
