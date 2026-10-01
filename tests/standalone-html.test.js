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
  assert.equal(scripts.length, 5);

  const context = vm.createContext({ TextEncoder, TextDecoder, Uint8Array, Uint8ClampedArray, crypto: webcrypto });
  vm.runInContext(scripts[0], context);
  vm.runInContext(scripts[1], context);
  vm.runInContext(scripts[2], context);

  const source = Uint8Array.from([0, 42, 255]);
  const packet = await context.VaultCore.encryptFile({ name: 'sample.bin', type: 'application/octet-stream', bytes: source }, 'secret');
  const image = context.ImageCodec.encodeData(packet);
  const decoded = context.ImageCodec.decode(image.pixels, image.width, image.height);
  const restored = await context.VaultCore.decryptFile(decoded.packet, 'secret');
  assert.equal(restored.name, 'sample.bin');
  assert.deepEqual(restored.bytes, source);
});


test('embedded modules restore a reordered multipart file without external scripts', async () => {
  const html = readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  const context = vm.createContext({TextEncoder,TextDecoder,Uint8Array,Uint8ClampedArray,crypto:webcrypto});
  for (const script of scripts.slice(0,3)) vm.runInContext(script, context);
  const source = Uint8Array.of(0,255,42,7,8), session = await context.VaultCore.createEncryptSession('secret');
  const images = [];
  for (const range of context.FileParts.planParts(5,{mode:'count',count:3})) {
    const packet = await session.encryptPart({name:'original.bin',type:'application/octet-stream',index:range.index,count:3,totalSize:5,offset:range.offset,bytes:source.slice(range.offset,range.offset+range.length)});
    images.push(context.ImageCodec.encodeData(packet));
  }
  const decrypt = context.VaultCore.createDecryptSession('secret'), parts = [];
  for (const image of images.reverse()) parts.push(await decrypt.decryptPacket(context.ImageCodec.decode(image.pixels,image.width,image.height).packet));
  const ordered = context.FileParts.validateSet(parts), blob = new Blob(ordered.map(part=>part.bytes),{type:ordered[0].type});
  assert.equal(ordered[0].name,'original.bin');
  assert.equal(blob.type,'application/octet-stream');
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())],[0,255,42,7,8]);
});

test('embedded ZIP module preserves a folder through encryption without external scripts', async () => {
  const html = readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  const context = vm.createContext({TextEncoder,TextDecoder,Uint8Array,Uint8ClampedArray,File,Blob,crypto:webcrypto});
  for (const script of scripts.slice(0,-1)) vm.runInContext(script,context);
  const {directoryFile} = require('./helpers/directory-file.js');
  const {readStoredZip} = require('./helpers/read-stored-zip.js');
  const archive = await context.DirectoryZip.create([directoryFile('folder/nested/a.txt','123456789')]);
  const packet = await context.VaultCore.encryptFile({name:archive.name,type:archive.type,bytes:new Uint8Array(await archive.arrayBuffer())},'secret');
  const image = context.ImageCodec.encodeData(packet);
  const restored = await context.VaultCore.decryptFile(context.ImageCodec.decode(image.pixels,image.width,image.height).packet,'secret');
  assert.equal(restored.name,'folder.zip');
  assert.equal(restored.type,'application/zip');
  const entries = readStoredZip(restored.bytes);
  assert.equal(entries[0].name,'folder/nested/a.txt');
  assert.equal(entries[0].bytes.toString(),'123456789');
});
