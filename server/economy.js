'use strict';
const fs = require('fs');
const path = require('path');

/** Viewer coin ledger with earn rules and debounced JSON persistence. */
class Economy {
  constructor(cfg, file) {
    this.cfg = cfg;
    this.file = file;
    this.viewers = {};
    this.saveTimer = null;
    this.load();
  }

  load() {
    try { this.viewers = JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch { this.viewers = {}; }
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.viewers, null, 1));
    }, 1000);
  }

  get(login, name) {
    let v = this.viewers[login];
    if (!v) {
      v = this.viewers[login] = {
        name: name || login, coins: this.cfg.startCoins, spent: 0, earned: 0,
        lastMsgAt: 0, lastEarnAt: 0, lastActiveAt: 0, lastBonusAt: Date.now(), lastCmdAt: 0,
      };
    }
    if (name && v.name !== name) v.name = name;
    return v;
  }

  /** Called on every chat message. Returns coins earned (0 if on cooldown). */
  onMessage(login, name) {
    const v = this.get(login, name);
    const now = Date.now();
    v.lastMsgAt = now; v.lastActiveAt = now;
    let earned = 0;
    if (now - v.lastEarnAt >= this.cfg.messageCooldownSeconds * 1000) {
      v.lastEarnAt = now; earned = this.cfg.coinsPerMessage;
      v.coins += earned; v.earned += earned;
    }
    this.save();
    return earned;
  }

  /** Periodic: active viewers get a bonus every N minutes. */
  tickBonuses() {
    const now = Date.now();
    const window = this.cfg.activeWindowMinutes * 60000;
    const interval = this.cfg.activeBonusIntervalMinutes * 60000;
    let changed = false;
    for (const v of Object.values(this.viewers)) {
      if (now - v.lastActiveAt > window) continue;
      if (now - v.lastBonusAt >= interval) {
        v.lastBonusAt = now; v.coins += this.cfg.activeBonusCoins; v.earned += this.cfg.activeBonusCoins; changed = true;
      }
    }
    if (changed) this.save();
  }

  /** Command rate limit. Returns true if allowed. */
  allowCommand(login) {
    const v = this.get(login);
    const now = Date.now();
    if (now - v.lastCmdAt < this.cfg.commandCooldownSeconds * 1000) return false;
    v.lastCmdAt = now;
    return true;
  }

  spend(login, amount) {
    const v = this.get(login);
    if (v.coins < amount) return false;
    v.coins -= amount; v.spent += amount;
    this.save();
    return true;
  }

  credit(login, name, amount) {
    const v = this.get(login, name);
    v.coins += amount; v.earned += amount;
    this.save();
  }

  topSpenders(n = 5) {
    return Object.values(this.viewers).sort((a, b) => b.spent - a.spent).slice(0, n)
      .map(v => ({ name: v.name, spent: v.spent }));
  }
}

module.exports = { Economy };
