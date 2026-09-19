import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, Blade, OneEuroFilter, segmentHitsCircle } from '../dist/core.js';

function game(mode = 'arcade', events = []) { const g = new GameEngine(1000, 640, e => events.push(e), () => 0.5); g.start(mode); g.spawnIn = 999; return g; }
function target(g, x, bomb = false) { const f = g.spawn(bomb); Object.assign(f, { x, y: 250, vx: 0, vy: 0 }); return f; }
test('a fast swipe hits fruit between samples and does not hit a nearby bomb', () => {
  assert.ok(segmentHitsCircle({ x: 0, y: 250 }, { x: 900, y: 250 }, { x: 450, y: 250 }, 35));
  assert.ok(!segmentHitsCircle({ x: 0, y: 250 }, { x: 900, y: 250 }, { x: 450, y: 320 }, 35));
});
test('each fruit scores only once, even when consecutive swipes overlap it', () => {
  const g = game(); target(g, 250);
  g.slice({ x: 50, y: 250 }, { x: 450, y: 250 }); g.slice({ x: 450, y: 250 }, { x: 50, y: 250 });
  assert.equal(g.score, 10); assert.equal(g.sliced, 1);
});
test('three fruit in one swipe earn a combo bonus', () => {
  const g = game(); [250, 450, 650].forEach(x => target(g, x));
  g.slice({ x: 0, y: 250 }, { x: 900, y: 250 });
  assert.equal(g.score, 35); assert.equal(g.maxCombo, 3); assert.equal(g.sliced, 3);
});
test('bombs deduct 30 points, reset the chain, and never produce negative scores', () => {
  const g = game(); g.score = 100; g.combo = 5; target(g, 400, true);
  g.slice({ x: 200, y: 250 }, { x: 600, y: 250 }); assert.equal(g.score, 70); assert.equal(g.combo, 0); assert.equal(g.bombs, 1);
  g.score = 10; target(g, 400, true); g.slice({ x: 200, y: 250 }, { x: 600, y: 250 }); assert.equal(g.score, 0);
});
test('a bomb in the middle of a stroke breaks the chain at its actual position', () => {
  const g = game(); g.score = 100; target(g, 300); target(g, 400, true); target(g, 500); target(g, 600);
  g.slice({ x: 0, y: 250 }, { x: 800, y: 250 }); assert.equal(g.combo, 2); assert.equal(g.score, 100);
});
test('reacquiring a lost hand cannot draw a phantom slice across the screen', () => {
  const b = new Blade(); assert.equal(b.move({ x: 100, y: 250 }, 1, { hand: true }), null);
  assert.ok(b.move({ x: 200, y: 250 }, 1.03, { hand: true })); b.clear();
  assert.equal(b.move({ x: 750, y: 250 }, 1.2, { hand: true }), null);
  assert.equal(b.move({ x: 100, y: 250 }, 2, { hand: true }), null);
});
test('a low-confidence position jump resets the hand trail', () => {
  const b = new Blade(); b.move({ x: 0, y: 50 }, 1, { hand: true });
  assert.equal(b.move({ x: 1000, y: 50 }, 1.03, { hand: true }), null); assert.equal(b.trail.length, 1);
});
test('idle hand jitter and mouse hover cannot cut fruit', () => {
  const b = new Blade(); b.move({ x: 100, y: 50 }, 1, { hand: true });
  assert.equal(b.move({ x: 101, y: 50 }, 1.03, { hand: true }), null);
  assert.equal(b.move({ x: 400, y: 50 }, 1.06, { active: false }), null);
});
test('pausing freezes time, movement, and scoring; resuming restores play', () => {
  const g = game(); const f = target(g, 400); g.pause(); g.update(5); g.slice({ x: 0, y: 250 }, { x: 800, y: 250 });
  assert.equal(g.remaining, 30); assert.equal(f.y, 250); assert.equal(g.score, 0);
  g.resume(); g.update(0.25); assert.equal(g.remaining, 29.75);
});
test('the round ends exactly once and no slices can score afterward', () => {
  const events = [], g = game('arcade', events); target(g, 400);
  g.update(29.9); g.update(0.2); g.update(4); g.slice({ x: 0, y: 250 }, { x: 800, y: 250 });
  assert.equal(g.remaining, 0); assert.equal(g.state, 'finished'); assert.equal(events.filter(e => e.type === 'finish').length, 1); assert.equal(g.score, 0);
});
test('Zen lasts 30 seconds and never spawns bombs', () => {
  const g = game('zen'); g.elapsed = 40;
  for (let i = 0; i < 100; i++) g.wave();
  assert.equal(g.duration, 30); assert.ok(g.entities.every(f => !f.bomb));
});
test('Arcade waves include bombs after the opening warmup', () => {
  const g = game(); g.random = () => 0.2; g.elapsed = 5; g.wave(); assert.ok(g.entities.some(f => f.bomb));
});
test('fruit waves rotate through different launch shapes instead of one fixed left-to-right order', () => {
  const g = game(); g.random = () => 0.8; g.elapsed = 1; g.wave();
  const fruit = g.entities.filter(item => !item.bomb);
  assert.ok(fruit[0].x > fruit.at(-1).x);
});
test('bombs can launch from interior lanes instead of always hugging a side', () => {
  const g = game(); g.random = () => 0.2; g.elapsed = 5; g.wave();
  const bomb = g.entities.find(item => item.bomb);
  assert.ok(bomb);
  assert.ok(bomb.x > bomb.radius * 2.1);
  assert.ok(bomb.x < g.width - bomb.radius * 2.1);
});
test('frame rates do not change the round length or materially change trajectories', () => {
  function simulate(fps) { const g = game(); const f = target(g, 400); f.vy = -600; for (let i = 0; i < fps; i++) g.update(1 / fps); return { y: f.y, remaining: g.remaining }; }
  const a = simulate(30), b = simulate(144);
  assert.ok(Math.abs(a.y - b.y) < 3); assert.ok(Math.abs(a.remaining - b.remaining) < 1e-8);
});
test('restarting clears the previous score, combo, bombs, and objects', () => {
  const g = game(); target(g, 400); g.score = 400; g.combo = 5; g.bombs = 3; g.start('zen');
  assert.equal(g.score, 0); assert.equal(g.combo, 0); assert.equal(g.bombs, 0); assert.equal(g.entities.length, 0); assert.equal(g.remaining, 30);
});
test('adaptive filtering reduces tiny jitter and resets after a tracking gap', () => {
  const f = new OneEuroFilter(); f.filter(100, 1); const steady = f.filter(102, 1.03);
  assert.ok(steady > 100 && steady < 102); assert.equal(f.filter(800, 2), 800); f.reset(); assert.equal(f.filter(20, 2.1), 20);
});
