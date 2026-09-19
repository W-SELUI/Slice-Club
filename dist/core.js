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
  clear() { this.point = null; this.time = null; this.trail = []; this.visualFrom = null; this.visualTo = null; this.visualStart = 0; }
  move(point, time, { active = true, hand = false, width = 1000, height = 640 } = {}) {
    const previous = this.point;
    const gap = this.time === null ? Infinity : time - this.time;
    const distance = previous ? Math.hypot(point.x - previous.x, point.y - previous.y) : 0;
    // Never connect a newly acquired hand or a stale sample to its previous position.
    const discontinuity = gap > 0.24 || (hand && distance > Math.hypot(width, height) * 0.46);
    if (discontinuity || !active) this.trail = [];
    this.visualFrom = discontinuity || !previous ? point : (this.visualTo || previous);
    this.visualTo = point;
    this.visualStart = performance.now() / 1000;
    this.point = point; this.time = time;
    if (active) this.trail.push({ ...point, time });
    this.trail = this.trail.filter(p => time - p.time < 0.19).slice(-22);
    return previous && active && !discontinuity && distance > (hand ? 2 : 1) ? [previous, point] : null;
  }
  visualPoint(now) {
    if (!this.visualFrom || !this.visualTo) return this.point;
    const progress = clamp((now - this.visualStart) / 0.045, 0, 1);
    return {
      x: this.visualFrom.x + (this.visualTo.x - this.visualFrom.x) * progress,
      y: this.visualFrom.y + (this.visualTo.y - this.visualFrom.y) * progress,
    };
  }
}

export class GameEngine {
  constructor(width, height, onEvent = () => {}, random = Math.random) {
    this.width = width; this.height = height; this.onEvent = onEvent; this.random = random; this.state = 'idle'; this.entities = []; this.nextId = 1;
  }
  start(mode = 'arcade') {
    // Short event rounds keep the queue moving while leaving enough time for a satisfying combo.
    this.mode = mode; this.duration = 30; this.remaining = this.duration;
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
    // Fruit is intentionally generous for a classroom setup. Bombs keep their original size.
    const radius = bomb ? clamp(w * 0.037, 27, 44) : clamp(w * 0.047, 34, 56);
    const x = position ?? radius * 1.5 + rnd() * (w - radius * 3);
    const y = h + radius * 1.5;
    const gravity = h * 1.52;
    const top = h * (0.29 + rnd() * 0.21);
    const vy = -Math.sqrt(2 * gravity * (y - top));
    const fruit = { id: this.nextId++, x, y, vx: (w / 2 - x) * 0.25 + (rnd() - 0.5) * w * 0.22, vy, radius, angle: rnd() * 6.28, spin: (rnd() - 0.5) * 3, bomb, kind: Math.floor(rnd() * FRUITS.length), sliced: false };
    this.entities.push(fruit); return fruit;
  }
  wave() {
    const rnd = this.random;
    const count = this.width < 550 ? 2 + (rnd() < 0.5 ? 1 : 0) : 3 + (rnd() < 0.35 ? 1 : 0);
    const pattern = Math.floor(rnd() * 4);
    const denominator = Math.max(1, count - 1);
    const launchedFruit = [];
    for (let i = 0; i < count; i++) {
      // Four launch shapes keep each wave readable but stop the game feeling like a conveyor belt.
      const progress = i / denominator;
      const shape = pattern === 1
        ? 0.5 + (i - (count - 1) / 2) * 0.21 + (rnd() - 0.5) * 0.13
        : pattern === 2
          ? (i % 2 ? 0.78 - progress * 0.2 : 0.18 + progress * 0.2)
          : pattern === 3
            ? 1 - progress
            : progress;
      const lane = clamp(0.14 + 0.72 * shape + (rnd() - 0.5) * 0.1, 0.08, 0.92);
      const fruit = this.spawn(false, this.width * lane);
      if (pattern === 1) fruit.vx += (rnd() - 0.5) * this.width * 0.22;
      if (pattern === 2) fruit.vy *= 0.88 + rnd() * 0.18;
      if (pattern === 3) fruit.vx += (i % 2 ? -1 : 1) * this.width * 0.06;
      launchedFruit.push(fruit);
    }
    if (this.mode === 'arcade' && this.elapsed > 4 && this.random() < 0.4) {
      // Bombs can occupy any safe lane, rather than always appearing on an edge.
      const margin = Math.max(this.width * 0.06, 60);
      let bombX = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        const candidate = margin + rnd() * (this.width - margin * 2);
        if (launchedFruit.every(fruit => Math.abs(candidate - fruit.x) > fruit.radius + 45)) {
          bombX = candidate;
          break;
        }
      }
      const bomb = this.spawn(true, bombX ?? margin + rnd() * (this.width - margin * 2));
      bomb.vx = (rnd() - 0.5) * this.width * 0.32;
      bomb.vy *= 0.83 + rnd() * 0.24;
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
