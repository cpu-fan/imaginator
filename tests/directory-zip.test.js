const test = require('node:test');
const assert = require('node:assert/strict');
const {existsSync} = require('node:fs');
const {directoryFile} = require('./helpers/directory-file.js');
const Zip = existsSync(require('node:path').join(__dirname, '../directory-zip.js')) ? require('../directory-zip.js') : null;

const {readStoredZip} = require('./helpers/read-stored-zip.js');

test('ZIP preserves nested Unicode paths, binary and empty files with valid CRC metadata', async () => {
  assert.ok(Zip, 'Directory ZIP support is missing');
  const files = [directoryFile('Документы/текст.txt', '123456789'), directoryFile('Документы/sub/binary.bin', Uint8Array.of(0, 255, 42)), directoryFile('Документы/empty.txt', '')];
  const archive = await Zip.create(files);
  assert.equal(archive.name, 'Документы.zip');
  assert.equal(archive.type, 'application/zip');
  assert.equal(Zip.plan(files).size, archive.size);
  const entries = readStoredZip(await archive.arrayBuffer());
  assert.deepEqual(entries.map(e => e.name), ['Документы/текст.txt', 'Документы/sub/binary.bin', 'Документы/empty.txt']);
  assert.equal(entries[0].crc, 0xcbf43926);
  assert.equal(entries[0].bytes.toString(), '123456789');
  assert.deepEqual([...entries[1].bytes], [0, 255, 42]);
  assert.equal(entries[2].bytes.length, 0);
  assert.equal(entries[2].crc, 0);
});

test('ZIP limits include headers before reading any source bytes', () => {
  assert.ok(Zip, 'Directory ZIP support is missing');
  // a/x adds 22 + 30 + 46 + 2*3 = 104 bytes.
  assert.equal(Zip.plan([{webkitRelativePath: 'a/x', size: 920}], {maxSize: 1024}).size, 1024);
  assert.throws(() => Zip.plan([{webkitRelativePath: 'a/x', size: 921}], {maxSize: 1024}), /ZIP.*размер|размер.*ZIP/i);
  assert.throws(() => Zip.plan(Array.from({length:65536}, () => ({webkitRelativePath:'a/x',size:0}))), /65535/);
  assert.throws(() => Zip.plan([{webkitRelativePath: 'a/' + 'x'.repeat(65534), size: 0}]), /длин/);
});

test('ZIP rejects missing, unsafe, duplicate and mixed-root paths', () => {
  assert.ok(Zip, 'Directory ZIP support is missing');
  assert.throws(() => Zip.plan([]), /папк/);
  for (const path of ['', '/a/x', 'a/../x', 'a/./x', 'a//x', 'a/x\\y', 'a/\0x', 'C:/x']) {
    assert.throws(() => Zip.plan([{webkitRelativePath:path,size:0}]), /путь/i, path);
  }
  assert.throws(() => Zip.plan([directoryFile('a/x',''), directoryFile('a/x','')]), /повтор/);
  assert.throws(() => Zip.plan([directoryFile('a/x',''), directoryFile('b/y','')]), /одн.*папк/);
});

test('ZIP reads large files in chunks and propagates read failures', async () => {
  assert.ok(Zip, 'Directory ZIP support is missing');
  const file = directoryFile('a/large.bin', new Uint8Array(2 * 1048576 + 1));
  file.arrayBuffer = () => { throw new Error('Whole-file read'); };
  const slice = file.slice.bind(file), reads = [];
  file.slice = (start, end) => { reads.push(end - start); return slice(start, end); };
  const archive = await Zip.create([file]);
  assert.equal(archive.size, file.size + 120);
  assert.ok(reads.length >= 3);
  assert.ok(reads.every(length => length <= 1048576));
  file.slice = () => ({arrayBuffer: async () => {throw new Error('Unreadable file');}});
  await assert.rejects(Zip.create([file]), /Unreadable file/);
});
