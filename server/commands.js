'use strict';

/**
 * Chat command handling. ctx = { game, economy, config, hub, reply(user, text) }.
 */
function parse(message) {
  const m = message.trim();
  if (!m.startsWith('!')) return null;
  const [cmd, ...args] = m.slice(1).split(/\s+/);
  return { cmd: cmd.toLowerCase(), args };
}

function shopText(cfg) {
  return Object.entries(cfg.enemies).map(([k, e]) => k + ' ' + e.cost + 'c').join(' | ');
}

const BUFF_COST = 60;

function spawnMany(ctx, user, type, count) {
  const { game, economy, config: cfg, hub } = ctx;
  const def = cfg.enemies[type];
  let spawned = 0;
  for (let i = 0; i < count; i++) {
    const r = game.spawnEnemy(type, { login: user.login, name: user.name });
    if (typeof r === 'string') { if (spawned === 0) ctx.reply(user, r); break; }
    economy.spend(user.login, def.cost);
    r.dist = -(i * 28); // stagger so a batch doesn't stack on one pixel
    spawned++;
  }
  if (spawned) {
    const label = spawned + ' ' + def.name + (spawned > 1 ? 's' : '');
    hub.log(user.name + ' spawned ' + label, 'spawn');
    hub.toast(user.name + ' sent ' + label + '!', 'spawn', 3);
  }
  return spawned;
}

function handle(ctx, user, message) {
  const p = parse(message);
  if (!p) return;
  const { game, economy, config: cfg, hub } = ctx;
  const eco = cfg.economy;
  const { cmd, args } = p;
  const v = economy.get(user.login, user.name);
  const say = (t) => ctx.reply(user, t);

  switch (cmd) {
    case 'help':
    case 'commands':
      return say('Commands: !spawn <enemy> [count] | !rush | !buff | !coins | !shop | !top. Earn coins by chatting.');

    case 'coins':
    case 'balance':
      return say(user.name + ' has ' + v.coins + ' coins (spent ' + v.spent + ' all-time).');

    case 'shop':
      return say('Shop: ' + shopText(cfg) + ' | !buff ' + BUFF_COST + 'c');

    case 'top': {
      const leak = game.leaderboard().map(l => l.name + ' ' + l.lives).join(', ') || 'nobody yet';
      const spend = economy.topSpenders(3).map(s => s.name + ' ' + s.spent).join(', ') || 'nobody yet';
      return say('Top leakers: ' + leak + ' | Top spenders: ' + spend);
    }

    case 'spawn':
    case 's': {
      if (!economy.allowCommand(user.login)) return;
      const type = (args[0] || '').toLowerCase();
      const def = cfg.enemies[type];
      if (!def) return say('Unknown enemy. Try: ' + Object.keys(cfg.enemies).join(', '));
      let count = Math.max(1, Math.min(eco.maxSpawnPerCommand, parseInt(args[1], 10) || 1));
      const affordable = Math.floor(v.coins / def.cost);
      if (affordable <= 0) return say('a ' + def.name + ' costs ' + def.cost + ' coins and you have ' + v.coins + '.');
      spawnMany(ctx, user, type, Math.min(count, affordable));
      return;
    }

    case 'rush': {
      if (!economy.allowCommand(user.login)) return;
      const [type, def] = Object.entries(cfg.enemies).sort((a, b) => a[1].cost - b[1].cost)[0];
      const total = def.cost * 5;
      if (v.coins < total) return say('!rush costs ' + total + ' coins (5x ' + def.name + '). You have ' + v.coins + '.');
      spawnMany(ctx, user, type, 5);
      return;
    }

    case 'buff': {
      if (!economy.allowCommand(user.login)) return;
      if (game.enemies.size === 0) return say('Nothing alive to buff.');
      if (!economy.spend(user.login, BUFF_COST)) return say('!buff costs ' + BUFF_COST + ' coins. You have ' + v.coins + '.');
      const n = game.buffEnemies(0.3);
      hub.toast(user.name + ' healed ' + n + ' enemies!', 'buff', 3);
      hub.log(user.name + ' used !buff', 'spawn');
      return;
    }

    default:
      return;
  }
}

module.exports = { parse, handle };
