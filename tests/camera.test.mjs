import test from 'node:test';
import assert from 'node:assert/strict';
import { HandTracker } from '../dist/hand.js';

function setup(getUserMedia) {
  globalThis.window = { isSecureContext: true, Worker: true, OffscreenCanvas: true, createImageBitmap: true };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia } } });
  globalThis.cancelAnimationFrame = () => {};
  globalThis.requestAnimationFrame = () => 1;
  const video = { pause() {}, play: async () => {}, srcObject: null };
  return new HandTracker(video, () => {}, () => {});
}
function stream() {
  const track = { stopped: false, stop() { this.stopped = true; }, addEventListener() {} };
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
}
test('cancelling while camera permission is pending promptly returns and stops a late stream', async () => {
  let resolve;
  const t = setup(() => new Promise(r => { resolve = r; }));
  const starting = t.start(() => {}); t.stop();
  assert.equal(await starting, false);
  const late = stream(); resolve(late); await Promise.resolve(); await Promise.resolve();
  assert.equal(late.track.stopped, true); assert.equal(t.video.srcObject, null);
});
test('denied permission gives a useful message without keeping a stream', async () => {
  const t = setup(async () => { const e = new Error(); e.name = 'NotAllowedError'; throw e; });
  await assert.rejects(t.start(() => {}), /Camera access was blocked/); assert.equal(t.stream, null);
});
test('cancelling while the model is loading stops the camera and worker', async () => {
  const s = stream(); const t = setup(async () => s);
  let worker;
  globalThis.Worker = class { constructor() { worker = this; } postMessage() {} terminate() { this.terminated = true; } };
  const starting = t.start(() => {});
  for (let i = 0; i < 15 && !worker; i++) await Promise.resolve();
  assert.ok(worker); t.stop(); assert.equal(await starting, false);
  assert.equal(worker.terminated, true); assert.equal(s.track.stopped, true); assert.equal(t.video.srcObject, null);
});
test('a worker initialization failure closes camera resources and allows retry', async () => {
  const s = stream(); const t = setup(async () => s);
  globalThis.Worker = class { postMessage() { queueMicrotask(() => this.onerror()); } terminate() {} };
  await assert.rejects(t.start(() => {}), /could not start/); assert.equal(s.track.stopped, true); assert.equal(t.worker, null);
});
test('a working camera start can be stopped repeatedly without leaving resources open', async () => {
  const s = stream(); const t = setup(async () => s);
  globalThis.Worker = class { postMessage() { queueMicrotask(() => this.onmessage({ data: { type: 'ready' } })); } terminate() { this.terminated = true; } };
  assert.equal(await t.start(() => {}), true); assert.equal(t.active, true);
  const worker = t.worker; t.stop(); t.stop();
  assert.equal(t.active, false); assert.equal(s.track.stopped, true); assert.equal(worker.terminated, true); assert.equal(t.video.srcObject, null);
});
