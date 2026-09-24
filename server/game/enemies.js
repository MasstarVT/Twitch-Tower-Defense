'use strict';

function createEnemy(id, type, def, owner, map) {
  const start = map.positionAt(0);
  return {
    id, type,
    hp: def.hp, maxHp: def.hp,
    speed: def.speed, armor: def.armor || 0,
    dist: 0, x: start.x, y: start.y, angle: start.angle,
    slow: 0, slowUntil: 0,
    owner, // { login, name } or null for wild spawns
    spawnedAt: Date.now(),
  };
}

/** Advance an enemy along the path. Returns true when it reaches the end. */
function updateEnemy(e, dt, map, now) {
  const factor = e.slowUntil > now ? 1 - e.slow : 1;
  e.dist += e.speed * factor * dt;
  const p = map.positionAt(e.dist);
  e.x = p.x; e.y = p.y; e.angle = p.angle;
  return e.dist >= map.length;
}

function applySlow(e, slow, seconds, now) {
  const until = now + seconds * 1000;
  // Stronger slow wins; equal slow just extends duration.
  if (slow > e.slow || until > e.slowUntil) {
    e.slow = Math.max(slow, e.slow);
    e.slowUntil = Math.max(until, e.slowUntil);
  }
}

module.exports = { createEnemy, updateEnemy, applySlow };
