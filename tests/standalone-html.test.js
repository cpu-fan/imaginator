const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const projectRoot = path.join(__dirname, '..');

test('built HTML works without local CSS or JavaScript files', async () => {
  const build = spawnSync(process.execPath, ['scripts/build-standalone.js'], {
    cwd: projectRoot,
    encoding: 'utf8'
  });
  assert.equal(build.status, 0, build.stderr);

  const html = readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /<link\b[^>]*rel="stylesheet"/i);
  assert.doesNotMatch(html, /<script\b[^>]*src=/i);
  assert.match(html, /<style>[\s\S]+<\/style>/);

  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.equal(scripts.length, 3);

  const context = vm.createContext({ TextEncoder, TextDecoder, Uint8Array, Uint8ClampedArray, crypto: webcrypto });
  vm.runInContext(scripts[0], context);
  vm.runInContext(scripts[1], context);

  const source = Uint8Array.from([0, 42, 255]);
  const packet = await context.VaultCore.encryptFile({ name: 'sample.bin', type: 'application/octet-stream', bytes: source }, 'secret');
  const image = context.ImageCodec.encodeData(packet);
  const decoded = context.ImageCodec.decode(image.pixels, image.width, image.height);
  const restored = await context.VaultCore.decryptFile(decoded.packet, 'secret');
  assert.equal(restored.name, 'sample.bin');
  assert.deepEqual(restored.bytes, source);
});
