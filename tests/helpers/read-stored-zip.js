const assert = require('node:assert/strict');
// Independent ZIP reader: check the central directory and every local record.
function readStoredZip(bytes) {
  const data = Buffer.from(bytes), end = data.length - 22;
  assert.equal(data.readUInt32LE(end), 0x06054b50);
  const count = data.readUInt16LE(end + 10), start = data.readUInt32LE(end + 16);
  let cursor = start;
  const entries = [];
  for (let i = 0; i < count; i++) {
    assert.equal(data.readUInt32LE(cursor), 0x02014b50);
    assert.equal(data.readUInt16LE(cursor + 8), 0x0800);
    assert.equal(data.readUInt16LE(cursor + 10), 0);
    const crc = data.readUInt32LE(cursor + 16), size = data.readUInt32LE(cursor + 24);
    assert.equal(data.readUInt32LE(cursor + 20), size);
    const nameLength = data.readUInt16LE(cursor + 28), offset = data.readUInt32LE(cursor + 42);
    const name = data.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    assert.equal(data.readUInt32LE(offset), 0x04034b50);
    assert.equal(data.readUInt16LE(offset + 6), 0x0800);
    assert.equal(data.readUInt16LE(offset + 8), 0);
    assert.equal(data.readUInt32LE(offset + 14), crc);
    assert.equal(data.readUInt32LE(offset + 18), size);
    assert.equal(data.readUInt32LE(offset + 22), size);
    assert.equal(data.subarray(offset + 30, offset + 30 + nameLength).toString('utf8'), name);
    entries.push({name, crc, bytes: data.subarray(offset + 30 + nameLength, offset + 30 + nameLength + size)});
    cursor += 46 + nameLength + data.readUInt16LE(cursor + 30) + data.readUInt16LE(cursor + 32);
  }
  assert.equal(cursor, end);
  assert.equal(cursor - start, data.readUInt32LE(end + 12));
  return entries;
}

module.exports = {readStoredZip};
