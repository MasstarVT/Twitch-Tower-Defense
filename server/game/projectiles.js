'use strict';

function createProjectile(id, kind, tower, stats, target) {
  return {
    id, kind, towerId: tower.id,
    x: tower.x, y: tower.y,
    targetId: target.id, lastX: target.x, lastY: target.y,
    speed: stats.projectileSpeed,
    damage: stats.damage, splash: stats.splash || 0,
    slow: stats.slow || 0, slowSeconds: stats.slowSeconds || 0,
    angle: Math.atan2(target.y - tower.y, target.x - tower.x),
  };
}

/** Instant visual for chain lightning; removed after ttl expires. */
function createBolt(id, tower, points) {
  return { id, kind: 'bolt', towerId: tower.id, x: tower.x, y: tower.y, points, ttl: 0.12 };
}

/**
 * Moves a projectile toward its target. Returns 'hit', 'expire', or null.
 * Splash projectiles keep flying to the target's last position if it died.
 */
function updateProjectile(p, dt, enemiesById) {
  if (p.kind === 'bolt') { p.ttl -= dt; return p.ttl <= 0 ? 'expire' : null; }
  const target = enemiesById.get(p.targetId);
  if (target) { p.lastX = target.x; p.lastY = target.y; }
  else if (!p.splash) return 'expire';
  const dx = p.lastX - p.x, dy = p.lastY - p.y;
  const d = Math.hypot(dx, dy);
  const step = p.speed * dt;
  if (d <= step + 6) { p.x = p.lastX; p.y = p.lastY; return 'hit'; }
  p.x += dx / d * step; p.y += dy / d * step;
  p.angle = Math.atan2(dy, dx);
  return null;
}

module.exports = { createProjectile, createBolt, updateProjectile };
