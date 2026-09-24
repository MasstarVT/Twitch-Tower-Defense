'use strict';
const { createEnemy, updateEnemy, applySlow } = require('./enemies');
const { createTower, towerStats, updateTower, dist2 } = require('./towers');
const { createProjectile, createBolt, updateProjectile } = require('./projectiles');

/**
 * Authoritative tower defense simulation.
 * Emits events through `emit(event)`: kill, leak, build, upgrade, sell, gameover, reset, spawn.
 */
class Game {
  constructor(config, map, emit) {
    this.cfg = config;
    this.map = map;
    this.emit = emit || (() => {});
    this.nextId = 1;
    this.streak = 0; // minutes survived this game
    this.reset();
  }

  reset() {
    const s = this.cfg.streamer;
    this.gold = s.startGold;
    this.lives = s.startLives;
    this.enemies = new Map();
    this.towers = new Map();
    this.projectiles = [];
    this.floats = [];
    this.paused = false;
    this.gameOver = false;
    this.gameOverAt = 0;
    this.elapsed = 0;
    this.incomeAcc = 0;
    this.streak = 0;
    this.lastSpawnAt = Date.now();
    this.stats = { kills: 0, leaked: 0, spawned: 0, leakers: {}, spawners: {} };
    this.emit({ type: 'reset' });
  }

  // ---- viewer actions -------------------------------------------------------

  livingFor(login) {
    let n = 0;
    for (const e of this.enemies.values()) if (e.owner && e.owner.login === login) n++;
    return n;
  }

  /** Spawn an enemy for a viewer (owner) or wild (owner=null). Returns enemy or an error string. */
  spawnEnemy(type, owner) {
    const def = this.cfg.enemies[type];
    if (!def) return 'Unknown enemy "' + type + '"';
    if (this.gameOver) return 'The streamer already lost. Wait for the next round.';
    const eco = this.cfg.economy;
    if (this.enemies.size >= eco.maxLivingTotal) return 'The board is full right now.';
    if (owner && this.livingFor(owner.login) >= eco.maxLivingPerUser) return 'You already have ' + eco.maxLivingPerUser + ' enemies alive.';
    const e = createEnemy(this.nextId++, type, def, owner, this.map);
    this.enemies.set(e.id, e);
    this.lastSpawnAt = Date.now();
    this.stats.spawned++;
    if (owner) this.stats.spawners[owner.name] = (this.stats.spawners[owner.name] || 0) + def.cost;
    this.emit({ type: 'spawn', enemy: type, owner });
    return e;
  }

  /** Heal all living enemies by a fraction. Returns count healed. */
  buffEnemies(fraction) {
    let n = 0;
    for (const e of this.enemies.values()) { e.hp = Math.min(e.maxHp, e.hp + e.maxHp * fraction); n++; }
    return n;
  }

  // ---- streamer actions -----------------------------------------------------

  towerAt(col, row) {
    for (const t of this.towers.values()) if (t.col === col && t.row === row) return t;
    return null;
  }

  build(type, col, row) {
    const def = this.cfg.towers[type];
    if (!def) return { ok: false, error: 'Unknown tower' };
    if (!this.map.isBuildable(col, row)) return { ok: false, error: 'Cannot build there' };
    if (this.towerAt(col, row)) return { ok: false, error: 'Cell occupied' };
    if (this.gold < def.cost) return { ok: false, error: 'Not enough gold' };
    this.gold -= def.cost;
    const t = createTower(this.nextId++, type, def, col, row, this.map);
    this.towers.set(t.id, t);
    this.emit({ type: 'build', tower: type });
    return { ok: true, id: t.id };
  }

  upgrade(id) {
    const t = this.towers.get(id);
    if (!t) return { ok: false, error: 'No such tower' };
    const def = this.cfg.towers[t.type];
    const cost = towerStats(t, def).upgradeCost;
    if (cost == null) return { ok: false, error: 'Max level' };
    if (this.gold < cost) return { ok: false, error: 'Not enough gold' };
    this.gold -= cost; t.invested += cost; t.level++;
    this.emit({ type: 'upgrade', tower: t.type, level: t.level + 1 });
    return { ok: true, level: t.level };
  }

  sell(id) {
    const t = this.towers.get(id);
    if (!t) return { ok: false, error: 'No such tower' };
    const refund = Math.round(t.invested * this.cfg.streamer.sellRefund);
    this.gold += refund;
    this.towers.delete(id);
    this.addFloat(t.x, t.y, '+' + refund + 'g', '#ffd54f');
    this.emit({ type: 'sell', tower: t.type, refund });
    return { ok: true, refund };
  }

  setPaused(p) { this.paused = !!p; }

  // ---- simulation -----------------------------------------------------------

  addFloat(x, y, text, color) {
    this.floats.push({ x, y, text, color, age: 0 });
  }

  damageEnemy(e, amount, tower) {
    if (e.hp <= 0) return;
    const dmg = Math.max(1, amount - e.armor);
    e.hp -= dmg;
    if (tower) tower.damageDealt += dmg;
    if (e.hp <= 0) this.killEnemy(e, tower);
  }

  killEnemy(e, tower) {
    const def = this.cfg.enemies[e.type];
    this.enemies.delete(e.id);
    this.gold += def.gold;
    this.stats.kills++;
    if (tower) tower.kills++;
    this.addFloat(e.x, e.y, '+' + def.gold + 'g', '#ffd54f');
    this.emit({ type: 'kill', enemy: e.type, owner: e.owner, gold: def.gold });
  }

  leakEnemy(e) {
    const def = this.cfg.enemies[e.type];
    this.enemies.delete(e.id);
    this.lives = Math.max(0, this.lives - def.lives);
    this.stats.leaked++;
    if (e.owner) this.stats.leakers[e.owner.name] = (this.stats.leakers[e.owner.name] || 0) + def.lives;
    this.addFloat(e.x, e.y, '-' + def.lives + (def.lives > 1 ? ' lives' : ' life'), '#ef5350');
    this.emit({ type: 'leak', enemy: e.type, owner: e.owner, lives: def.lives, cost: def.cost });
    if (this.lives <= 0 && !this.gameOver) this.endGame();
  }

  endGame() {
    this.gameOver = true;
    this.gameOverAt = Date.now();
    this.emit({ type: 'gameover', leaders: this.leaderboard(), kills: this.stats.kills, elapsed: this.elapsed });
  }

  leaderboard() {
    return Object.entries(this.stats.leakers).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, lives]) => ({ name, lives }));
  }

  fire(tower, stats, target, now) {
    const def = this.cfg.towers[tower.type];
    if (def.projectile === 'bolt') {
      // Chain lightning resolves instantly.
      const hit = new Set([target.id]);
      const points = [{ x: tower.x, y: tower.y }, { x: target.x, y: target.y }];
      let cur = target;
      this.damageEnemy(cur, stats.damage, tower);
      for (let i = 1; i < stats.chain; i++) {
        let next = null, best = stats.chainRange * stats.chainRange;
        for (const e of this.enemies.values()) {
          if (hit.has(e.id)) continue;
          const d = dist2(cur, e);
          if (d < best) { best = d; next = e; }
        }
        if (!next) break;
        hit.add(next.id);
        points.push({ x: next.x, y: next.y });
        this.damageEnemy(next, stats.damage * 0.7, tower);
        cur = next;
      }
      this.projectiles.push(createBolt(this.nextId++, tower, points));
      return;
    }
    this.projectiles.push(createProjectile(this.nextId++, def.projectile, tower, stats, target));
  }

  hit(p, now) {
    const tower = this.towers.get(p.towerId) || null;
    if (p.splash) {
      const r2 = p.splash * p.splash;
      for (const e of [...this.enemies.values()]) {
        if (dist2(p, e) <= r2) this.damageEnemy(e, p.damage, tower);
      }
      return;
    }
    const e = this.enemies.get(p.targetId);
    if (!e) return;
    if (p.slow) applySlow(e, p.slow, p.slowSeconds, now);
    this.damageEnemy(e, p.damage, tower);
  }

  tick(dt) {
    const now = Date.now();
    if (this.gameOver) {
      if (now - this.gameOverAt > this.cfg.streamer.gameOverResetSeconds * 1000) this.reset();
      return;
    }
    if (this.paused) return;
    this.elapsed += dt;

    // Passive income once a minute
    this.incomeAcc += dt;
    if (this.incomeAcc >= 60) {
      this.incomeAcc -= 60;
      this.gold += this.cfg.streamer.incomePerMinute;
      this.streak++;
    }

    // Idle trickle keeps the board alive when chat is quiet
    const it = this.cfg.idleTrickle;
    if (it && it.enabled && this.enemies.size === 0 && now - this.lastSpawnAt > it.afterSeconds * 1000) {
      this.spawnEnemy(it.enemy, null);
    }

    // Towers
    const living = [...this.enemies.values()];
    for (const t of this.towers.values()) {
      updateTower(t, this.cfg.towers[t.type], dt, living, (tower, stats, target) => this.fire(tower, stats, target, now));
    }

    // Projectiles
    const keep = [];
    for (const p of this.projectiles) {
      const r = updateProjectile(p, dt, this.enemies);
      if (r === 'hit') this.hit(p, now);
      else if (r !== 'expire') keep.push(p);
    }
    this.projectiles = keep;

    // Enemies
    for (const e of [...this.enemies.values()]) {
      if (e.hp <= 0) continue;
      if (updateEnemy(e, dt, this.map, now)) this.leakEnemy(e);
    }

    // Floating text
    for (const f of this.floats) f.age += dt;
    this.floats = this.floats.filter(f => f.age < 1.2);
  }
}

module.exports = { Game };
