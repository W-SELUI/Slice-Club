export const FRUITS = [
  { emoji: '🍉', color: '#ff557d', name: 'watermelon' },
  { emoji: '🍊', color: '#ffab3d', name: 'orange' },
  { emoji: '🍋', color: '#e5f15b', name: 'lemon' },
  { emoji: '🍓', color: '#ff4670', name: 'strawberry' },
  { emoji: '🥝', color: '#b0e660', name: 'kiwi' },
  { emoji: '🍎', color: '#ef4f62', name: 'apple' },
];
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export function segmentHitsCircle(a, b, c, radius) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? clamp(((c.x - a.x) * dx + (c.y - a.y) * dy) / len, 0, 1) : 0;
  return (a.x + dx * t - c.x) ** 2 + (a.y + dy * t - c.y) ** 2 <= radius * radius;
}

// Adaptive low-pass: quiet when the hand is still, responsive during a swipe.
export class OneEuroFilter {
  constructor(minCutoff = 1.8, beta = 0.09) { this.minCutoff = minCutoff; this.beta = beta; this.reset(); }
  reset() { this.value = null; this.raw = null; this.time = null; this.derivative = 0; }
  filter(value, time) {
    if (this.value === null || time - this.time > 0.3) { this.value = this.raw = value; this.time = time; return value; }
    const dt = Math.max(0.001, time - this.time);
    const alpha = cutoff => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    const derivative = (value - this.raw) / dt;
    this.derivative += alpha(1) * (derivative - this.derivative);
    this.value += alpha(this.minCutoff + this.beta * Math.abs(this.derivative)) * (value - this.value);
    this.raw = value; this.time = time;
    return this.value;
  }
}

export class Blade {
  constructor() { this.clear(); }
  clear() { this.point = null; this.time = null; this.trail = []; }
  move(point, time, { active = true, hand = false, width = 1000, height = 640 } = {}) {
    const previous = this.point;
    const gap = this.time === null ? Infinity : time - this.time;
    const distance = previous ? Math.hypot(point.x - previous.x, point.y - previous.y) : 0;
    // Never connect a newly acquired hand or a stale sample to its previous position.
    const discontinuity = gap > 0.24 || (hand && distance > Math.hypot(width, height) * 0.46);
    if (discontinuity || !active) this.trail = [];
    this.point = point; this.time = time;
    if (active) this.trail.push({ ...point, time });
    this.trail = this.trail.filter(p => time - p.time < 0.19).slice(-22);
    return previous && active && !discontinuity && distance > (hand ? 2 : 1) ? [previous, point] : null;
  }
}

export class GameEngine {
  constructor(width, height, onEvent = () => {}, random = Math.random) {
    this.width = width; this.height = height; this.onEvent = onEvent; this.random = random; this.state = 'idle'; this.entities = []; this.nextId = 1;
  }
  start(mode = 'arcade') {
    this.mode = mode; this.duration = mode === 'zen' ? 90 : 60; this.remaining = this.duration;
    this.elapsed = 0; this.score = 0; this.sliced = 0; this.bombs = 0; this.combo = 0; this.maxCombo = 0;
    this.lastSlice = -Infinity; this.spawnIn = 0.35; this.entities = []; this.state = 'playing';
  }
  resize(width, height) {
    for (const f of this.entities) { f.x *= width / this.width; f.y *= height / this.height; f.vx *= width / this.width; f.vy *= height / this.height; }
    this.width = width; this.height = height;
  }
  pause() { if (this.state === 'playing') this.state = 'paused'; }
  resume() { if (this.state === 'paused') this.state = 'playing'; }
  spawn(bomb = false, position = null) {
    const rnd = this.random, w = this.width, h = this.height;
    const radius = clamp(w * 0.037, 27, 44);
    const x = position ?? radius * 1.5 + rnd() * (w - radius * 3);
    const y = h + radius * 1.5;
    const gravity = h * 1.52;
    const top = h * (0.29 + rnd() * 0.21);
    const vy = -Math.sqrt(2 * gravity * (y - top));
    const fruit = { id: this.nextId++, x, y, vx: (w / 2 - x) * 0.25 + (rnd() - 0.5) * w * 0.22, vy, radius, angle: rnd() * 6.28, spin: (rnd() - 0.5) * 3, bomb, kind: Math.floor(rnd() * FRUITS.length), sliced: false };
    this.entities.push(fruit); return fruit;
  }
  wave() {
    const count = this.width < 550 ? 2 + (this.random() < 0.5 ? 1 : 0) : 3 + (this.random() < 0.35 ? 1 : 0);
    for (let i = 0; i < count; i++) this.spawn(false, this.width * (0.15 + 0.7 * (i + this.random() * 0.5) / count));
    if (this.mode === 'arcade' && this.elapsed > 4 && this.random() < 0.4) {
      const bomb = this.spawn(true);
      // A bomb gets its own lane so a freshly launched bunch is fair to slice.
      bomb.x = this.random() < 0.5 ? bomb.radius * 1.5 : this.width - bomb.radius * 1.5;
      bomb.vx = (this.width / 2 - bomb.x) * 0.14;
      bomb.vy *= 0.87;
    }
  }
  update(dt) {
    if (this.state !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
    const delta = Math.min(dt, this.remaining);
    this.remaining = Math.max(0, this.remaining - delta); this.elapsed += delta;
    if (this.elapsed - this.lastSlice > 0.48) this.combo = 0;
    // Substeps preserve the flight arcs on slow frames.
    let left = delta;
    while (left > 0) {
      const step = Math.min(left, 1 / 90); left -= step;
      this.spawnIn -= step;
      if (this.spawnIn <= 0) { this.wave(); this.spawnIn = Math.max(0.75, 1.6 - this.elapsed * 0.012) + this.random() * 0.2; }
      for (const f of this.entities) {
        f.x += f.vx * step; f.y += f.vy * step; f.vy += this.height * 1.52 * step; f.angle += f.spin * step;
        if (f.x < f.radius) { f.x = f.radius; f.vx = Math.abs(f.vx); }
        if (f.x > this.width - f.radius) { f.x = this.width - f.radius; f.vx = -Math.abs(f.vx); }
      }
      this.entities = this.entities.filter(f => {
        if (f.sliced) return false;
        if (f.y > this.height + f.radius * 3 && f.vy > 0) { if (!f.bomb) this.combo = 0; return false; }
        return true;
      });
    }
    if (this.remaining <= 0) { this.state = 'finished'; this.onEvent({ type: 'finish' }); }
  }
  slice(a, b) {
    if (this.state !== 'playing' || Math.hypot(b.x - a.x, b.y - a.y) < 1) return;
    const hits = this.entities.filter(f => !f.sliced && segmentHitsCircle(a, b, f, f.radius * (f.bomb ? 0.78 : 0.9) + 5));
    // Process in stroke order, including a bomb resetting only the chain before it.
    const dx = b.x - a.x, dy = b.y - a.y;
    hits.sort((f, g) => (f.x - g.x) * dx + (f.y - g.y) * dy);
    for (const f of hits) {
      f.sliced = true;
      if (f.bomb) {
        this.score = Math.max(0, this.score - 30); this.bombs++; this.combo = 0; this.lastSlice = -Infinity;
        this.onEvent({ type: 'bomb', fruit: f, points: -30 });
      } else {
        this.combo = this.elapsed - this.lastSlice <= 0.48 ? this.combo + 1 : 1;
        this.lastSlice = this.elapsed; this.maxCombo = Math.max(this.maxCombo, this.combo);
        const bonus = this.combo >= 3 ? Math.min(this.combo - 2, 5) * 5 : 0;
        const points = 10 + bonus; this.score += points; this.sliced++;
        this.onEvent({ type: 'slice', fruit: f, points, combo: this.combo, angle: Math.atan2(dy, dx) });
      }
    }
  }
}
