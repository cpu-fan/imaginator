(function (root) {
  'use strict';

  const DATA_MAGIC = [86, 68, 65, 84]; // VDAT
  const STEGO_MAGIC = [86, 83, 84, 71]; // VSTG
  const HEADER_LENGTH = 8;
  const MAX_SIDE = 16384;
  const MAX_PIXELS = 100000000;

  function dimensions(width, height) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
        width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE ||
        width * height > MAX_PIXELS) {
      throw new RangeError('Invalid image dimensions');
    }
    return width * height;
  }

  function checkPixels(pixels, width, height) {
    const count = dimensions(width, height);
    if (!(pixels instanceof Uint8ClampedArray) || pixels.length !== count * 4) {
      throw new TypeError('Pixels must be an RGBA Uint8ClampedArray matching the dimensions');
    }
    return count;
  }

  function checkPacket(packet) {
    if (!(packet instanceof Uint8Array)) {
      throw new TypeError('Packet must be a Uint8Array');
    }
    if (packet.length > 0xffffffff) {
      throw new RangeError('Packet length exceeds header limit');
    }
  }

  function header(magic, length) {
    const bytes = new Uint8Array(HEADER_LENGTH);
    bytes.set(magic);
    new DataView(bytes.buffer).setUint32(4, length);
    return bytes;
  }

  function rgbIndex(channel) {
    return channel + Math.floor(channel / 3);
  }

  function coverCapacity(width, height) {
    return Math.max(0, Math.floor(dimensions(width, height) * 3 / 8) - HEADER_LENGTH);
  }

  function encodeData(packet) {
    checkPacket(packet);
    const requiredPixels = Math.ceil((HEADER_LENGTH + packet.length) / 3);
    if (requiredPixels > MAX_PIXELS) {
      throw new RangeError('Packet exceeds image capacity');
    }
    const width = Math.ceil(Math.sqrt(requiredPixels));
    const height = Math.ceil(requiredPixels / width);
    dimensions(width, height);
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
    const bytes = header(DATA_MAGIC, packet.length);
    for (let i = 0; i < bytes.length; i++) pixels[rgbIndex(i)] = bytes[i];
    for (let i = 0; i < packet.length; i++) pixels[rgbIndex(HEADER_LENGTH + i)] = packet[i];
    return { width, height, pixels };
  }

  function encodeStego(packet, pixels, width, height) {
    checkPacket(packet);
    checkPixels(pixels, width, height);
    if (Math.floor(width * height * 3 / 8) < HEADER_LENGTH + packet.length) {
      throw new RangeError('Packet exceeds cover capacity');
    }
    const output = pixels.slice();
    for (let i = 3; i < output.length; i += 4) output[i] = 255;
    const bytes = header(STEGO_MAGIC, packet.length);
    function embed(byte, byteIndex) {
      for (let bit = 0; bit < 8; bit++) {
        const index = rgbIndex(byteIndex * 8 + bit);
        output[index] = (output[index] & 254) | ((byte >> (7 - bit)) & 1);
      }
    }
    for (let i = 0; i < bytes.length; i++) embed(bytes[i], i);
    for (let i = 0; i < packet.length; i++) embed(packet[i], HEADER_LENGTH + i);
    return output;
  }

  function decode(pixels, width, height) {
    const count = checkPixels(pixels, width, height);
    const channels = count * 3;
    function readByte(mode, position) {
      if (mode === 'data') return pixels[rgbIndex(position)];
      let value = 0;
      for (let bit = 0; bit < 8; bit++) {
        value = (value << 1) | (pixels[rgbIndex(position * 8 + bit)] & 1);
      }
      return value;
    }
    function matches(magic, mode) {
      if (channels < magic.length * (mode === 'data' ? 1 : 8)) return false;
      return magic.every((byte, i) => readByte(mode, i) === byte);
    }
    let mode;
    if (matches(DATA_MAGIC, 'data')) mode = 'data';
    else if (matches(STEGO_MAGIC, 'stego')) mode = 'stego';
    else throw new Error('Invalid image magic');
    const availableBytes = Math.floor(channels / (mode === 'data' ? 1 : 8));
    if (availableBytes < HEADER_LENGTH) throw new RangeError('Image header exceeds capacity');
    let length = 0;
    for (let i = 4; i < HEADER_LENGTH; i++) length = length * 256 + readByte(mode, i);
    if (length > availableBytes - HEADER_LENGTH) {
      throw new RangeError('Declared packet length exceeds image capacity');
    }
    const packet = new Uint8Array(length);
    for (let i = 0; i < length; i++) packet[i] = readByte(mode, HEADER_LENGTH + i);
    return { mode, packet };
  }

  root.ImageCodec = { coverCapacity, encodeData, encodeStego, decode };
  if (typeof module === 'object' && module.exports) module.exports = root.ImageCodec;
})(typeof globalThis !== 'undefined' ? globalThis : this);
