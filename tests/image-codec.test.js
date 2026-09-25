const test = require('node:test');
const assert = require('node:assert/strict');
const ImageCodec = require('../image-codec.js');

test('data pixels carry the header and packet in RGB order', () => {
  const packet = Uint8Array.from([0, 127, 255, 42]);
  const image = ImageCodec.encodeData(packet);
  assert.equal(image.pixels.length, image.width * image.height * 4);
  assert.deepEqual(Array.from(image.pixels.slice(0, 16)), [86, 68, 65, 255, 84, 0, 0, 255, 0, 4, 0, 255, 127, 255, 42, 255]);
  assert.ok(Array.from(image.pixels).every((value, index) => index % 4 !== 3 || value === 255));
  assert.deepEqual(ImageCodec.decode(image.pixels, image.width, image.height), { mode: 'data', packet });
});

test('stego pixels round-trip a packet while preserving dimensions and other RGB bits', () => {
  const width = 8;
  const height = 8;
  const cover = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < cover.length; i++) cover[i] = (i * 13) % 256;
  const packet = Uint8Array.from([1, 0, 255, 5, 42]);
  const pixels = ImageCodec.encodeStego(packet, cover, width, height);
  assert.equal(pixels.length, cover.length);
  for (let i = 0; i < pixels.length; i++) {
    if (i % 4 === 3) assert.equal(pixels[i], 255);
    else assert.equal(pixels[i] & 254, cover[i] & 254);
  }
  assert.deepEqual(ImageCodec.decode(pixels, width, height), { mode: 'stego', packet });
});

test('cover capacity counts the eight-byte header and accepts its exact boundary', () => {
  assert.equal(ImageCodec.coverCapacity(8, 8), 16);
  const cover = new Uint8ClampedArray(8 * 8 * 4);
  const packet = new Uint8Array(16).fill(0xa5);
  assert.deepEqual(ImageCodec.decode(ImageCodec.encodeStego(packet, cover, 8, 8), 8, 8).packet, packet);
  assert.throws(() => ImageCodec.encodeStego(new Uint8Array(17), cover, 8, 8), /capacity/i);
});

test('a tiny cover cannot hold the header', () => {
  assert.equal(ImageCodec.coverCapacity(2, 2), 0);
  assert.throws(() => ImageCodec.encodeStego(new Uint8Array(), new Uint8ClampedArray(16), 2, 2), /capacity/i);
});

test('decode rejects invalid magic', () => {
  const pixels = new Uint8ClampedArray(12 * 4);
  assert.throws(() => ImageCodec.decode(pixels, 4, 3), /magic/i);
});

test('decode rejects a declared packet longer than data pixels', () => {
  const image = ImageCodec.encodeData(Uint8Array.from([7]));
  image.pixels[9] = 255; // low byte of the big-endian declared length
  assert.throws(() => ImageCodec.decode(image.pixels, image.width, image.height), /length|capacity/i);
});

test('decode rejects a declared packet longer than stego pixels', () => {
  const cover = new Uint8ClampedArray(8 * 8 * 4);
  const pixels = ImageCodec.encodeStego(Uint8Array.from([7]), cover, 8, 8);
  // Set a high bit of the length field to make it exceed the cover.
  const highBitChannel = 32 + Math.floor(32 / 3);
  pixels[highBitChannel] |= 1;
  assert.throws(() => ImageCodec.decode(pixels, 8, 8), /length|capacity/i);
});

test('rejects zero or canvas-exceeding dimensions', () => {
  for (const [width, height] of [[0, 1], [1, 0], [16385, 1], [10001, 10000]]) {
    assert.throws(() => ImageCodec.coverCapacity(width, height), /dimension/i);
  }
});
