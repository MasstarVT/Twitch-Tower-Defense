'use strict';

const r = (n) => Math.round(n * 10) / 10;

/** Lean view of game state sent to overlay + control panel. */
function snapshot(game) {
  const now = Date.now();
  const enemies = [];
  for (const e of game.enemies.values()) {
    enemies.push({
      id: e.id, t: e.type, x: r(e.x), y: r(e.y), a: r(e.angle),
      hp: Math.max(0, e.hp / e.maxHp), o: e.owner ? e.owner.name : null,
      s: e.slowUntil > now ? 1 : 0,
    });
  }
  const towers = [];
  for (const t of game.towers.values()) {
    towers.push({ id: t.id, t: t.type, c: t.col, r: t.row, l: t.level, a: r(t.angle), k: t.kills, inv: t.invested });
  }
  const projectiles = game.projectiles.map(p => (
    p.kind === 'bolt' ? { id: p.id, k: 'bolt', pts: p.points } : { id: p.id, k: p.kind, x: r(p.x), y: r(p.y), a: r(p.angle) }
  ));
  return {
    type: 'state',
    gold: game.gold, lives: game.lives, paused: game.paused,
    gameOver: game.gameOver,
    resetIn: game.gameOver ? Math.max(0, game.cfg.streamer.gameOverResetSeconds - (now - game.gameOverAt) / 1000) : 0,
    elapsed: Math.floor(game.elapsed), streak: game.streak,
    kills: game.stats.kills, leaked: game.stats.leaked,
    leaders: game.leaderboard(),
    enemies, towers, projectiles,
    floats: game.floats.map(f => ({ x: r(f.x), y: r(f.y), text: f.text, color: f.color, age: r(f.age) })),
  };
}

module.exports = { snapshot };
