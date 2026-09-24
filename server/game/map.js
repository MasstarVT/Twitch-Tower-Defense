'use strict';
const fs = require('fs');

/**
 * Loads a map json and precomputes the walkable path as a world-space polyline.
 * Path waypoints are cell coordinates; consecutive waypoints must share a row or column.
 */
class GameMap {
  constructor(data) {
    this.name = data.name || 'Map';
    this.cols = data.cols;
    this.rows = data.rows;
    this.cell = data.cellSize;
    this.width = this.cols * this.cell;
    this.height = this.rows * this.cell;
    this.overlay = data.overlay || {};
    this.waypoints = data.path.map(([c, r]) => ({ x: (c + 0.5) * this.cell, y: (r + 0.5) * this.cell }));
    this.pathCells = new Set();
    this.blocked = new Set((data.blocked || []).map(([c, r]) => `${c},${r}`));
    this._rasterizePath(data.path);
    this._buildSegments();
  }

  static load(file) {
    return new GameMap(JSON.parse(fs.readFileSync(file, 'utf8')));
  }

  _rasterizePath(path) {
    for (let i = 0; i < path.length - 1; i++) {
      const [c0, r0] = path[i];
      const [c1, r1] = path[i + 1];
      if (c0 !== c1 && r0 !== r1) throw new Error(`Map path segment ${i} is not axis-aligned`);
      const dc = Math.sign(c1 - c0), dr = Math.sign(r1 - r0);
      let c = c0, r = r0;
      for (;;) {
        if (c >= 0 && r >= 0 && c < this.cols && r < this.rows) this.pathCells.add(`${c},${r}`);
        if (c === c1 && r === r1) break;
        c += dc; r += dr;
      }
    }
  }

  _buildSegments() {
    this.segments = [];
    let acc = 0;
    for (let i = 0; i < this.waypoints.length - 1; i++) {
      const a = this.waypoints[i], b = this.waypoints[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      this.segments.push({ a, b, len, start: acc, angle: Math.atan2(b.y - a.y, b.x - a.x) });
      acc += len;
    }
    this.length = acc;
  }

  /** Position and heading at a distance along the path. */
  positionAt(dist) {
    if (dist <= 0) return { x: this.waypoints[0].x, y: this.waypoints[0].y, angle: this.segments[0].angle };
    for (const s of this.segments) {
      if (dist <= s.start + s.len) {
        const t = (dist - s.start) / s.len;
        return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t, angle: s.angle };
      }
    }
    const last = this.waypoints[this.waypoints.length - 1];
    return { x: last.x, y: last.y, angle: this.segments[this.segments.length - 1].angle };
  }

  inBounds(c, r) { return c >= 0 && r >= 0 && c < this.cols && r < this.rows; }
  isPath(c, r) { return this.pathCells.has(`${c},${r}`); }
  isBuildable(c, r) { return this.inBounds(c, r) && !this.isPath(c, r) && !this.blocked.has(`${c},${r}`); }
  cellCenter(c, r) { return { x: (c + 0.5) * this.cell, y: (r + 0.5) * this.cell }; }

  /** Data the clients need to draw the map. */
  toJSON() {
    return {
      name: this.name, cols: this.cols, rows: this.rows, cellSize: this.cell,
      pathCells: [...this.pathCells].map(k => k.split(',').map(Number)),
      waypoints: this.waypoints,
      blocked: [...this.blocked].map(k => k.split(',').map(Number)),
      overlay: this.overlay,
    };
  }
}

module.exports = { GameMap };
