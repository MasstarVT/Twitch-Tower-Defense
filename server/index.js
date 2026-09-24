'use strict';
require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');

const { GameMap } = require('./game/map');
const { Game } = require('./game/game');
const { snapshot } = require('./game/snapshot');
const { Hub } = require('./ws');
const { Economy } = require('./economy');
const commands = require('./commands');
const twitch = require('./twitch');

const ROOT = path.join(__dirname, '..');
const config = require(path.join(ROOT, 'config.json'));
const map = GameMap.load(path.join(ROOT, config.map));
const economy = new Economy(config.economy, path.join(ROOT, 'data', 'viewers.json'));

// ---- HTTP + WS ---------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(express.static(path.join(ROOT, 'public')));
app.get('/', (_, res) => res.redirect('/control.html'));
const server = http.createServer(app);

let hub; // assigned below; game events reference it
const game = new Game(config, map, onGameEvent);

hub = new Hub(server, {
  initPayload: () => ({ map: map.toJSON(), towers: config.towers, enemies: config.enemies, streamer: config.streamer }),
  onControl: (msg) => {
    switch (msg.type) {
      case 'build': return game.build(msg.tower, msg.col, msg.row);
      case 'upgrade': return game.upgrade(msg.id);
      case 'sell': return game.sell(msg.id);
      case 'pause': game.setPaused(msg.paused); return { ok: true };
      case 'reset': game.reset(); return { ok: true };
      case 'chat': {
        const name = msg.user || 'DevUser';
        handleChat({ login: name.toLowerCase(), name, message: msg.message || '' });
        return { ok: true };
      }
      default: return { ok: false, error: 'unknown message' };
    }
  },
});

// ---- Twitch ------------------------------------------------------------------
const chat = twitch.connect({
  channel: process.env.TWITCH_CHANNEL,
  username: process.env.TWITCH_BOT_USERNAME,
  oauth: process.env.TWITCH_OAUTH,
}, handleChat);

function reply(user, text) {
  if (chat.canSay) chat.say('@' + user.name + ' ' + text);
  else hub.toast(user.name + ': ' + text, 'reply', 5);
}

function handleChat(user) {
  economy.onMessage(user.login, user.name);
  commands.handle({ game, economy, config, hub, reply }, user, user.message);
}

function onGameEvent(ev) {
  if (!hub) return;
  switch (ev.type) {
    case 'leak':
      if (ev.owner) {
        const refund = Math.round(ev.cost * config.economy.leakRefundMultiplier);
        economy.credit(ev.owner.login, ev.owner.name, refund);
        hub.log(ev.owner.name + "'s " + ev.enemy + ' leaked (-' + ev.lives + ' life, +' + refund + 'c to them)', 'leak');
      } else {
        hub.log('A wild ' + ev.enemy + ' leaked (-' + ev.lives + ' life)', 'leak');
      }
      break;
    case 'gameover':
      hub.toast('CHAT WINS! The defenses have fallen.', 'gameover', config.streamer.gameOverResetSeconds);
      hub.log('Game over after ' + Math.floor(ev.elapsed) + 's with ' + ev.kills + ' kills', 'gameover');
      break;
    case 'reset': hub.log('New game started', 'info'); break;
    case 'build': hub.log('Built ' + ev.tower, 'build'); break;
    case 'upgrade': hub.log('Upgraded ' + ev.tower + ' to level ' + ev.level, 'build'); break;
    case 'sell': hub.log('Sold ' + ev.tower + ' for ' + ev.refund + 'g', 'build'); break;
  }
}

// ---- Dev endpoints -----------------------------------------------------------
app.post('/dev/chat', (req, res) => {
  const { user = 'DevUser', message = '' } = req.body || {};
  handleChat({ login: user.toLowerCase(), name: user, message });
  res.json({ ok: true });
});
app.post('/dev/spawn', (req, res) => {
  const body = req.body || {};
  const owner = body.user ? { login: body.user.toLowerCase(), name: body.user } : null;
  const r = game.spawnEnemy(body.type || 'goblin', owner);
  res.json(typeof r === 'string' ? { ok: false, error: r } : { ok: true, id: r.id });
});
app.post('/dev/grant', (req, res) => {
  const { user = 'DevUser', coins = 500 } = req.body || {};
  economy.credit(user.toLowerCase(), user, Number(coins) || 0);
  hub.toast(user + ' was granted ' + coins + ' coins (dev)', 'info', 2);
  res.json({ ok: true, coins: economy.get(user.toLowerCase()).coins });
});
app.get('/dev/state', (_, res) => res.json(snapshot(game)));

// ---- Loops -------------------------------------------------------------------
const TICK = 1 / config.tickRate;
let last = process.hrtime.bigint();
let acc = 0;
setInterval(() => {
  const now = process.hrtime.bigint();
  acc += Number(now - last) / 1e9;
  last = now;
  if (acc > 0.25) acc = 0.25; // avoid spiral of death after a stall
  while (acc >= TICK) { game.tick(TICK); acc -= TICK; }
}, 1000 / config.tickRate);

setInterval(() => hub.broadcast(snapshot(game)), 1000 / config.snapshotRate);
setInterval(() => economy.tickBonuses(), 15000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Twitch Tower Defense running');
  console.log('  overlay:  http://localhost:' + PORT + '/overlay.html');
  console.log('  control:  http://localhost:' + PORT + '/control.html');
});
