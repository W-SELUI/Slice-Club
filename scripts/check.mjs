import { readFile, stat } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const html = await readFile(path.join(root, 'index.html'), 'utf8');
const css = await readFile(path.join(root, 'styles.css'), 'utf8');
const game = await readFile(path.join(root, 'game.js'), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
assert.equal(new Set(ids).size, ids.length, 'Duplicate HTML IDs');
for (const m of game.matchAll(/(?:\$|\btext|\bshow)\('([^']+)'/g)) assert.ok(ids.includes(m[1]), `Missing UI target ${m[1]}`);
const assets = new Set([...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m => m[1]).filter(s => !s.startsWith('data:') && s !== './'));
for (const file of ['game.js', 'hand.js', 'hand-worker.js']) {
  const source = await readFile(path.join(root, file), 'utf8');
  for (const m of source.matchAll(/(?:from\s+|new URL\(|importScripts\()'\.\/([^']+)'/g)) if (!m[1].endsWith('/wasm')) assets.add(m[1]);
}
for (const name of ['assets/hand_landmarker.task','vendor/vision_bundle.js','vendor/wasm/vision_wasm_internal.js','vendor/wasm/vision_wasm_internal.wasm','vendor/wasm/vision_wasm_nosimd_internal.js','vendor/wasm/vision_wasm_nosimd_internal.wasm']) assets.add(name);
for (const asset of assets) assert.ok((await stat(path.join(root, asset))).size > 0, `Missing or empty asset: ${asset}`);
assert.ok(css.includes('[hidden]')); assert.ok(html.includes('aria-live="polite"')); assert.ok(html.includes('playsinline'));
const model = await readFile(path.join(root, 'assets/hand_landmarker.task'));
assert.equal(model.subarray(2, 4).toString(), 'PK', 'Hand model has an unexpected header');
for (const file of ['vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.wasm']) {
  const wasm = await readFile(path.join(root, 'vendor/wasm', file));
  assert.equal(wasm.subarray(0, 4).toString('hex'), '0061736d', 'Invalid WebAssembly header');
}
console.log(`Validated ${assets.size} local assets, ${ids.length} unique UI IDs, model and WebAssembly headers.`);
