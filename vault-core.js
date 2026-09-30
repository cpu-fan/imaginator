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
      { name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' },
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

  const Parts = typeof module === 'object' && module.exports ? require('./file-parts.js') : root.FileParts;
  const PART_HEADER_LENGTH = 40;
  const MAX_PART_PACKET = HEADER_LENGTH + PART_HEADER_LENGTH + 2 * 0xffff + 64 * 1024 * 1024 + GCM_TAG_LENGTH;
  function hex(bytes) { return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''); }
  function checkPartPacket(packet) {
    if (!(packet instanceof Uint8Array) || packet.length < HEADER_LENGTH + PART_HEADER_LENGTH + GCM_TAG_LENGTH || packet.length > MAX_PART_PACKET ||
        !MAGIC.every((byte, index) => packet[index] === byte) || packet[4] !== 2 ||
        new DataView(packet.buffer, packet.byteOffset, packet.byteLength).getUint32(5) !== packet.length - HEADER_LENGTH) {
      throw new Error('Malformed file packet');
    }
  }
  async function createEncryptSession(password) {
    checkPassword(password);
    const crypto = webCrypto();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const setIdBytes = crypto.getRandomValues(new Uint8Array(16));
    const setId = hex(setIdBytes);
    const key = await deriveKey(password, salt, 'encrypt');
    const usedIvs = new Set();
    return { async encryptPart(input) {
      if (!input || !(input.bytes instanceof Uint8Array)) throw new TypeError('File bytes must be a Uint8Array');
      const info = { ...input, setId, length: input.bytes.length };
      Parts.validatePart(info);
      const { nameBytes, typeBytes } = metadata(info.name, info.type);
      const plain = new Uint8Array(PART_HEADER_LENGTH + nameBytes.length + typeBytes.length + info.length);
      const fields = new DataView(plain.buffer);
      fields.setUint16(0, nameBytes.length); fields.setUint16(2, typeBytes.length); fields.setUint32(4, info.length);
      plain.set(setIdBytes, 8);
      fields.setUint32(24, info.index); fields.setUint32(28, info.count); fields.setUint32(32, info.totalSize); fields.setUint32(36, info.offset);
      plain.set(nameBytes, PART_HEADER_LENGTH); plain.set(typeBytes, PART_HEADER_LENGTH + nameBytes.length);
      plain.set(input.bytes, PART_HEADER_LENGTH + nameBytes.length + typeBytes.length);
      let iv, ivId;
      do { iv = crypto.getRandomValues(new Uint8Array(12)); ivId = hex(iv); } while (usedIvs.has(ivId));
      usedIvs.add(ivId);
      const header = new Uint8Array(HEADER_LENGTH);
      header.set(MAGIC); header[4] = 2;
      new DataView(header.buffer).setUint32(5, plain.length + GCM_TAG_LENGTH);
      header.set(salt, 9); header.set(iv, 25);
      const cipher = new Uint8Array(await crypto.subtle.encrypt({ name:'AES-GCM', iv, additionalData:header }, key, plain));
      const packet = new Uint8Array(HEADER_LENGTH + cipher.length); packet.set(header); packet.set(cipher, HEADER_LENGTH);
      return packet;
    }};
  }
  function createDecryptSession(password) {
    checkPassword(password);
    const keys = new Map();
    return { async decryptPacket(packet) {
      if (!(packet instanceof Uint8Array) || packet.length < HEADER_LENGTH || !MAGIC.every((byte,index)=>packet[index]===byte)) throw new Error('Malformed file packet');
      if (packet[4] === 1) return { version:1, ...await decryptFile(packet,password) };
      if (packet[4] !== 2) throw new Error('Unsupported file packet');
      checkPartPacket(packet);
      const salt = packet.slice(9,25), iv = packet.slice(25,37), saltId = hex(salt);
      if (!keys.has(saltId)) keys.set(saltId,deriveKey(password,salt,'decrypt'));
      const key = await keys.get(saltId);
      let plain;
      try { plain = new Uint8Array(await webCrypto().subtle.decrypt({name:'AES-GCM',iv,additionalData:packet.subarray(0,HEADER_LENGTH)},key,packet.subarray(HEADER_LENGTH))); }
      catch { throw new Error('Wrong password or corrupted file packet'); }
      if (plain.length < PART_HEADER_LENGTH) throw new Error('Malformed file packet');
      const fields = new DataView(plain.buffer), nameLength = fields.getUint16(0), typeLength = fields.getUint16(2), length = fields.getUint32(4);
      if (PART_HEADER_LENGTH + nameLength + typeLength + length !== plain.length) throw new Error('Malformed file packet');
      const nameEnd = PART_HEADER_LENGTH + nameLength, typeEnd = nameEnd + typeLength;
      const result = {version:2,setId:hex(plain.subarray(8,24)),name:decoder.decode(plain.subarray(PART_HEADER_LENGTH,nameEnd)),type:decoder.decode(plain.subarray(nameEnd,typeEnd)),
        index:fields.getUint32(24),count:fields.getUint32(28),totalSize:fields.getUint32(32),offset:fields.getUint32(36),length,bytes:plain.subarray(typeEnd)};
      Parts.validatePart(result);
      return result;
    }};
  }
  const VaultCore = { estimatePacketLength, encryptFile, decryptFile, createEncryptSession, createDecryptSession };
  if (typeof module === 'object' && module.exports) {
    module.exports = VaultCore;
  } else {
    root.VaultCore = VaultCore;
  }
})(globalThis);
