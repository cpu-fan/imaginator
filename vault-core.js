(function (root) {
  'use strict';

  const MAGIC = Uint8Array.from([70, 86, 76, 84]); // FVLT
  const VERSION = 1;
  const HEADER_LENGTH = 37;
  const PLAINTEXT_HEADER_LENGTH = 8;
  const GCM_TAG_LENGTH = 16;
  const MAX_FILE_LENGTH = 10 * 1024 * 1024;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });

  function webCrypto() {
    const crypto = typeof module === 'object' && module.exports
      ? require('node:crypto').webcrypto
      : root.crypto;
    if (!crypto || !crypto.subtle || !crypto.getRandomValues) {
      throw new Error('Web Crypto is unavailable');
    }
    return crypto;
  }

  function metadata(name, type) {
    if (typeof name !== 'string' || typeof type !== 'string') {
      throw new TypeError('File name and MIME type must be strings');
    }
    const nameBytes = encoder.encode(name);
    const typeBytes = encoder.encode(type);
    if (nameBytes.length > 0xffff || typeBytes.length > 0xffff) {
      throw new RangeError('File name or MIME type is too long');
    }
    return { nameBytes, typeBytes };
  }

  function checkFileLength(fileSize) {
    if (!Number.isSafeInteger(fileSize) || fileSize < 0) {
      throw new RangeError('Invalid file length');
    }
    if (fileSize > MAX_FILE_LENGTH) {
      throw new RangeError('File exceeds 10 MiB limit');
    }
  }

  function estimatePacketLength(fileSize, name, mimeType) {
    checkFileLength(fileSize);
    const { nameBytes, typeBytes } = metadata(name, mimeType);
    return HEADER_LENGTH + PLAINTEXT_HEADER_LENGTH + nameBytes.length + typeBytes.length + fileSize + GCM_TAG_LENGTH;
  }

  function checkPassword(password) {
    if (typeof password !== 'string' || !password.trim()) {
      throw new TypeError('A non-blank password is required');
    }
  }

  async function deriveKey(password, salt, usage) {
    const crypto = webCrypto();
    const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      [usage]
    );
  }

  async function encryptFile(file, password) {
    checkPassword(password);
    if (!file || !(file.bytes instanceof Uint8Array)) {
      throw new TypeError('File bytes must be a Uint8Array');
    }
    checkFileLength(file.bytes.length);
    const { nameBytes, typeBytes } = metadata(file.name, file.type);
    const plaintext = new Uint8Array(PLAINTEXT_HEADER_LENGTH + nameBytes.length + typeBytes.length + file.bytes.length);
    const fields = new DataView(plaintext.buffer);
    fields.setUint16(0, nameBytes.length);
    fields.setUint16(2, typeBytes.length);
    fields.setUint32(4, file.bytes.length);
    plaintext.set(nameBytes, PLAINTEXT_HEADER_LENGTH);
    plaintext.set(typeBytes, PLAINTEXT_HEADER_LENGTH + nameBytes.length);
    plaintext.set(file.bytes, PLAINTEXT_HEADER_LENGTH + nameBytes.length + typeBytes.length);

    const crypto = webCrypto();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, 'encrypt');
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
    const packet = new Uint8Array(HEADER_LENGTH + ciphertext.length);
    packet.set(MAGIC);
    packet[4] = VERSION;
    new DataView(packet.buffer).setUint32(5, ciphertext.length);
    packet.set(salt, 9);
    packet.set(iv, 25);
    packet.set(ciphertext, HEADER_LENGTH);
    return packet;
  }

  async function decryptFile(packet, password) {
    checkPassword(password);
    if (!(packet instanceof Uint8Array) || packet.length < HEADER_LENGTH + PLAINTEXT_HEADER_LENGTH + GCM_TAG_LENGTH) {
      throw new Error('Malformed file packet');
    }
    if (!MAGIC.every((byte, index) => packet[index] === byte) || packet[4] !== VERSION) {
      throw new Error('Unsupported file packet');
    }
    const ciphertextLength = new DataView(packet.buffer, packet.byteOffset + 5, 4).getUint32(0);
    if (ciphertextLength !== packet.length - HEADER_LENGTH || ciphertextLength < PLAINTEXT_HEADER_LENGTH + GCM_TAG_LENGTH) {
      throw new Error('Malformed file packet');
    }
    const salt = packet.slice(9, 25);
    const iv = packet.slice(25, HEADER_LENGTH);
    const ciphertext = packet.slice(HEADER_LENGTH);
    const key = await deriveKey(password, salt, 'decrypt');
    let plaintext;
    try {
      plaintext = new Uint8Array(await webCrypto().subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext));
    } catch {
      throw new Error('Wrong password or corrupted file packet');
    }
    if (plaintext.length < PLAINTEXT_HEADER_LENGTH) {
      throw new Error('Malformed file packet');
    }
    const fields = new DataView(plaintext.buffer);
    const nameLength = fields.getUint16(0);
    const typeLength = fields.getUint16(2);
    const fileLength = fields.getUint32(4);
    if (fileLength > MAX_FILE_LENGTH || PLAINTEXT_HEADER_LENGTH + nameLength + typeLength + fileLength !== plaintext.length) {
      throw new Error('Malformed file packet');
    }
    const nameEnd = PLAINTEXT_HEADER_LENGTH + nameLength;
    const typeEnd = nameEnd + typeLength;
    return {
      name: decoder.decode(plaintext.subarray(PLAINTEXT_HEADER_LENGTH, nameEnd)),
      type: decoder.decode(plaintext.subarray(nameEnd, typeEnd)),
      bytes: plaintext.slice(typeEnd)
    };
  }

  const VaultCore = { estimatePacketLength, encryptFile, decryptFile };
  if (typeof module === 'object' && module.exports) {
    module.exports = VaultCore;
  } else {
    root.VaultCore = VaultCore;
  }
})(globalThis);
