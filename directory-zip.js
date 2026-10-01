(function (root) {
  'use strict';

  const MAX_SIZE = 512 * 1024 * 1024;
  const CHUNK_SIZE = 1024 * 1024;
  const encoder = new TextEncoder();
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    crcTable[i] = crc;
  }

  // Stored ZIP: its exact size is known before any file is read.
  function plan(files, {maxSize = MAX_SIZE} = {}) {
    files = Array.from(files);
    if (!files.length) throw new Error('Выберите папку с файлами. Пустые папки браузер не передаёт.');
    if (files.length > 65535) throw new Error('В папке должно быть не больше 65535 файлов.');
    const paths = new Set(), entries = [];
    let folder, size = 22;
    for (const file of files) {
      const path = file.webkitRelativePath;
      if (typeof path !== 'string' || /[\\\x00-\x1f:]/.test(path)) throw new Error('Некорректный путь файла в папке.');
      const segments = path.split('/');
      if (segments.length < 2 || segments.some(segment => !segment || segment === '.' || segment === '..')) throw new Error('Некорректный путь файла в папке.');
      if (folder && folder !== segments[0]) throw new Error('Выберите файлы одной папки.');
      folder = segments[0];
      if (paths.has(path)) throw new Error('В папке повторяется путь файла.');
      paths.add(path);
      const name = encoder.encode(path);
      if (name.length > 65535) throw new Error('Путь файла в папке слишком длинный для ZIP.');
      if (!Number.isSafeInteger(file.size) || file.size < 0) throw new Error('Некорректный размер файла в папке.');
      size += 76 + 2 * name.length + file.size;
      if (size > Math.min(maxSize, MAX_SIZE)) throw new Error('Размер ZIP превышает допустимый размер. Максимум — 512 MB, при скрытии в картинке — 10 MB.');
      entries.push({file, name});
    }
    return {name: `${folder}.zip`, type: 'application/zip', size, entries};
  }

  async function checksum(file) {
    let crc = 0xffffffff;
    for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
      const bytes = new Uint8Array(await file.slice(offset, Math.min(file.size, offset + CHUNK_SIZE)).arrayBuffer());
      for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function timestamp(lastModified) {
    const date = new Date(lastModified);
    const year = date.getFullYear();
    if (!Number.isFinite(year) || year < 1980) return {time: 0, date: 33};
    if (year > 2107) return {time: 0xbf7d, date: 0xff9f};
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >>> 1),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
  }

  async function create(files, options = {}) {
    const archive = plan(files, options), localRecords = [], centralRecords = [];
    let offset = 0, centralSize = 0;
    for (let index = 0; index < archive.entries.length; index++) {
      const {file, name} = archive.entries[index];
      if (options.onProgress) options.onProgress(index + 1, archive.entries.length);
      const crc = await checksum(file), stamp = timestamp(file.lastModified);
      const local = new Uint8Array(30 + name.length), header = new DataView(local.buffer);
      header.setUint32(0, 0x04034b50, true);
      header.setUint16(4, 20, true);
      header.setUint16(6, 0x0800, true); // UTF-8 filenames
      header.setUint16(10, stamp.time, true);
      header.setUint16(12, stamp.date, true);
      header.setUint32(14, crc, true);
      header.setUint32(18, file.size, true);
      header.setUint32(22, file.size, true);
      header.setUint16(26, name.length, true);
      local.set(name, 30);
      const central = new Uint8Array(46 + name.length), directory = new DataView(central.buffer);
      directory.setUint32(0, 0x02014b50, true);
      directory.setUint16(4, 20, true);
      // Version, flags, method, timestamp, CRC, sizes and name length.
      central.set(local.subarray(4, 28), 6);
      directory.setUint32(42, offset, true);
      central.set(name, 46);
      localRecords.push(local, file);
      centralRecords.push(central);
      offset += local.length + file.size;
      centralSize += central.length;
    }
    const end = new Uint8Array(22), header = new DataView(end.buffer);
    header.setUint32(0, 0x06054b50, true);
    header.setUint16(8, archive.entries.length, true);
    header.setUint16(10, archive.entries.length, true);
    header.setUint32(12, centralSize, true);
    header.setUint32(16, offset, true);
    return new File([...localRecords, ...centralRecords, end], archive.name, {type: archive.type});
  }

  const DirectoryZip = {plan, create};
  if (typeof module === 'object' && module.exports) module.exports = DirectoryZip;
  else root.DirectoryZip = DirectoryZip;
})(typeof globalThis === 'object' ? globalThis : this);
