'use strict';

function createTower(id, type, def, col, row, map) {
  const c = map.cellCenter(col, row);
  return {
    id, type, col, row, x: c.x, y: c.y,
    level: 0, cooldown: 0, angle: 0, targetId: null,
    kills: 0, damageDealt: 0, invested: def.cost,
  };
}

function towerStats(tower, def) {
  return def.levels[tower.level];
}

function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }

function pickTarget(tower, stats, enemies, targeting) {
  const r2 = stats.range * stats.range;
  let best = null, bestScore = -Infinity;
  for (const e of enemies) {
    if (e.hp <= 0) continue;
    if (dist2(tower, e) > r2) continue;
    const score = targeting === 'strongest' ? e.hp : e.dist; // 'first' = furthest along path
    if (score > bestScore) { bestScore = score; best = e; }
  }
  return best;
}

/** Ticks one tower; calls fire(tower, stats, target) when it shoots. */
function updateTower(tower, def, dt, enemies, fire) {
  tower.cooldown -= dt;
  const stats = towerStats(tower, def);
  const target = pickTarget(tower, stats, enemies, def.targeting || 'first');
  tower.targetId = target ? target.id : null;
  if (target) tower.angle = Math.atan2(target.y - tower.y, target.x - tower.x);
  if (target && tower.cooldown <= 0) {
    tower.cooldown = 1 / stats.fireRate;
    fire(tower, stats, target);
  }
}

module.exports = { createTower, towerStats, updateTower, dist2 };
