const test = require('node:test');
const assert = require('node:assert/strict');
const VaultCore = require('../vault-core.js');

test('estimates the exact packet length including UTF-8 metadata and GCM tag', () => {
  assert.equal(VaultCore.estimatePacketLength(3, 'a.txt', 'text/plain'), 79);
  assert.equal(VaultCore.estimatePacketLength(0, '猫.png', 'image/png'), 77);
});

test('round-trips file bytes, name, and MIME type', async () => {
  const file = { name: 'photo.bin', type: 'application/octet-stream', bytes: Uint8Array.from([0, 255, 1, 42]) };
  const packet = await VaultCore.encryptFile(file, 'correct horse');
  assert.equal(packet.length, VaultCore.estimatePacketLength(file.bytes.length, file.name, file.type));
  assert.deepEqual(Array.from(packet.subarray(0, 5)), [70, 86, 76, 84, 1]);
  assert.equal(new DataView(packet.buffer, packet.byteOffset + 5, 4).getUint32(0), packet.length - 37);
  assert.deepEqual(await VaultCore.decryptFile(packet, 'correct horse'), file);
});

test('round-trips an empty file', async () => {
  const file = { name: 'empty.txt', type: 'text/plain', bytes: new Uint8Array() };
  const packet = await VaultCore.encryptFile(file, 'secret');
  assert.deepEqual(await VaultCore.decryptFile(packet, 'secret'), file);
});

test('round-trips a Unicode filename', async () => {
  const file = { name: '写真-猫🖼️.png', type: 'image/png', bytes: Uint8Array.from([1, 2]) };
  const packet = await VaultCore.encryptFile(file, 'secret');
  assert.deepEqual(await VaultCore.decryptFile(packet, 'secret'), file);
});

test('decrypts the fixed PBKDF2 310000-iteration packet fixture', async () => {
  // Generated independently with node:crypto pbkdf2Sync and createCipheriv.
  const packet = Uint8Array.from(Buffer.from(
    '46564c54010000001a000102030405060708090a0b0c0d0e0f101112131415161718191a1b3ccd7d969257d0f81075491cfd23db79e5a1598c296474d3f265',
    'hex'
  ));
  assert.deepEqual(await VaultCore.decryptFile(packet, 'interop'), {
    name: 'x', type: '', bytes: Uint8Array.from([7])
  });
});

test('rejects a wrong password without returning file data', async () => {
  const packet = await VaultCore.encryptFile({ name: 'private', type: '', bytes: Uint8Array.from([7]) }, 'right');
  await assert.rejects(VaultCore.decryptFile(packet, 'wrong'));
});

test('rejects malformed packets before returning file data', async () => {
  const packet = await VaultCore.encryptFile({ name: 'x', type: '', bytes: Uint8Array.from([7]) }, 'secret');
  const wrongMagic = packet.slice();
  wrongMagic[0] = 0;
  const wrongVersion = packet.slice();
  wrongVersion[4] = 2;
  const wrongLength = packet.slice();
  wrongLength[8] ^= 1;
  const corruptCiphertext = packet.slice();
  corruptCiphertext[corruptCiphertext.length - 1] ^= 1;
  for (const malformed of [new Uint8Array(), packet.subarray(0, 36), wrongMagic, wrongVersion, wrongLength, corruptCiphertext]) {
    await assert.rejects(VaultCore.decryptFile(malformed, 'secret'));
  }
});

test('rejects a source file over 10 MiB', async () => {
  const file = { name: 'large', type: '', bytes: new Uint8Array(10 * 1024 * 1024 + 1) };
  await assert.rejects(VaultCore.encryptFile(file, 'secret'), /10 MiB/);
});

test('rejects blank passwords', async () => {
  const file = { name: 'x', type: '', bytes: new Uint8Array() };
  await assert.rejects(VaultCore.encryptFile(file, '  '), /password/i);
  const packet = await VaultCore.encryptFile(file, 'secret');
  await assert.rejects(VaultCore.decryptFile(packet, ''), /password/i);
});
