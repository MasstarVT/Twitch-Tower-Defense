// Sprite loader. Reads assets/atlas.json which maps logical names to image files.
// If the atlas or an image is missing, draw calls return false so the renderer can fall back to shapes.
export class Sprites {
  constructor() {
    this.images = new Map();
    this.atlas = null;
    this.ready = false;
  }

  async load(url = 'assets/atlas.json') {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.statusText);
      this.atlas = await res.json();
    } catch (e) {
      console.warn('[sprites] no atlas, using shapes:', e.message);
      return;
    }
    const base = this.atlas.base || 'assets/';
    const jobs = [];
    this.meta = new Map();
    for (const [name, def] of Object.entries(this.atlas.sprites || {})) {
      const d = typeof def === 'string' ? { file: def } : def;
      // Sheet art faces "up" by default in the Kenney pack; our angles are 0 = +x (right).
      const rot = d.facing === 'up' ? Math.PI / 2 : d.facing === 'down' ? -Math.PI / 2 : 0;
      this.meta.set(name, { scale: d.scale || 1, rot });
      jobs.push(this._loadImage(base + d.file).then((img) => { if (img) this.images.set(name, img); }));
    }
    await Promise.all(jobs);
    this.ready = true;
  }

  _loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => { console.warn('[sprites] missing', src); resolve(null); };
      img.src = src;
    });
  }

  has(name) { return this.images.has(name); }

  /** Draw sprite centred at (x,y) rotated by angle, scaled to `size` px (longest side). */
  draw(ctx, name, x, y, angle = 0, size = 48, alpha = 1) {
    const img = this.images.get(name);
    if (!img) return false;
    const m = this.meta.get(name) || { scale: 1, rot: 0 };
    const s = size * m.scale / Math.max(img.width, img.height);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + m.rot);
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, -img.width * s / 2, -img.height * s / 2, img.width * s, img.height * s);
    ctx.restore();
    return true;
  }

  /** Draw an axis-aligned tile filling a cell. */
  tile(ctx, name, x, y, size, alpha = 1) {
    const img = this.images.get(name);
    if (!img) return false;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, x, y, size, size);
    ctx.restore();
    return true;
  }
}
