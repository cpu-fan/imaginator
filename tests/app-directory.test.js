const test = require('node:test');
const assert = require('node:assert/strict');
const {createAppHarness} = require('./helpers/app-harness.js');
const {directoryFile} = require('./helpers/directory-file.js');
const {readStoredZip} = require('./helpers/read-stored-zip.js');

async function selectFolder(h, mode, files) {
  assert.ok(h.nodes.has(`${mode}-source-kind`), 'Folder source control is missing');
  await h.setValue(`${mode}-source-kind`, 'folder', 'change');
  await h.setFiles(`${mode}-folder`, files);
  await h.setValue(`${mode}-password`, 'secret');
}

for (const split of ['single', 'count']) test('folder survives PNG encryption and restoration: ' + split, async () => {
  const h = createAppHarness();
  await selectFolder(h, 'data', [directoryFile('Папка/a.txt', '123456789'), directoryFile('Папка/nested/b.bin', Uint8Array.of(0,255))]);
  await h.setValue('data-split-mode', split, 'change');
  if (split === 'count') await h.setValue('data-part-count', '3');
  assert.match(h.nodes.get('data-split-summary').textContent, /Частей: /);
  await h.submit('data');
  assert.equal(h.entries('data').length, split === 'single' ? 1 : 3, h.status('data'));
  const pngs = h.entries('data').map(e => e.blob).reverse();
  await h.setFiles('extract-image', pngs);
  await h.setValue('extract-password', 'secret');
  await h.submit('extract');
  const restored = h.entries('extract')[0];
  assert.ok(restored, h.status('extract'));
  assert.equal(restored.name, 'Папка.zip');
  assert.equal(restored.blob.type, 'application/zip');
  const entries = readStoredZip(await restored.blob.arrayBuffer());
  assert.deepEqual(entries.map(e => e.name), ['Папка/a.txt', 'Папка/nested/b.bin']);
  assert.equal(entries[0].bytes.toString(), '123456789');
  assert.deepEqual([...entries[1].bytes], [0,255]);
  h.unload();
});

test('folder works with the image cover and capacity uses the full ZIP size', async () => {
  const h = createAppHarness();
  await selectFolder(h, 'hide', [directoryFile('a/x', 'hi')]);
  const cover = new File(['cover'], 'cover.png');
  cover.image = {width:100,height:100,pixels:new Uint8ClampedArray(40000).fill(255)};
  await h.setFiles('hide-cover', [cover]);
  assert.match(h.nodes.get('capacity-text').textContent, /поместится/);
  await h.submit('hide');
  assert.equal(h.entries('hide').length, 1, h.status('hide'));
  await h.setFiles('extract-image', [h.entries('hide')[0].blob]);
  await h.setValue('extract-password','secret');
  await h.submit('extract');
  assert.equal(h.entries('extract')[0].name,'a.zip');
  assert.equal(readStoredZip(await h.entries('extract')[0].blob.arrayBuffer())[0].bytes.toString(), 'hi');
  h.unload();
});

test('source mode changes discard downloads and do not encrypt the inactive source', async () => {
  const h = createAppHarness();
  await h.setFiles('data-file', [new File(['old'],'old.txt')]);
  await selectFolder(h,'data',[directoryFile('new/x','new')]);
  assert.equal(h.nodes.get('data-file-field').hidden, true);
  assert.equal(h.nodes.get('data-folder-field').hidden, false);
  await h.submit('data');
  assert.match(h.entries('data')[0].name,/new/);
  const urls = [...h.activeUrls.keys()];
  await h.setValue('data-source-kind','file','change');
  assert.equal(h.hasResult('data'),false);
  assert.ok(urls.every(url => h.revokedUrls.has(url)));
  await h.setFiles('data-file', [new File(['next'],'next.txt')]);
  await h.submit('data');
  assert.equal(h.entries('data')[0].name,'next.png');
  h.unload();
});

test('oversized folder is rejected before reading or creating outputs', async () => {
  const h = createAppHarness();
  await selectFolder(h,'data',[{webkitRelativePath:'a/x',name:'x',size:512*1048576,slice(){throw new Error('Source read');}}]);
  assert.equal(h.nodes.get('data-split-summary').classList.contains('is-error'),true);
  await h.submit('data');
  assert.match(h.status('data'),/ZIP/);
  assert.equal(h.hasResult('data'),false);
  assert.equal(h.downloads().length,0);
});

test('empty selection and unreadable folder leave the form available for retry', async () => {
  const h = createAppHarness();
  await selectFolder(h,'data',[]);
  await h.submit('data');
  assert.equal(h.hasResult('data'),false);
  assert.match(h.status('data'),/папк/);
  const broken = directoryFile('a/x','x');
  broken.slice = () => ({arrayBuffer:async()=>{throw new Error('Не удалось прочитать файл');}});
  await h.setFiles('data-folder',[broken]);
  await h.submit('data');
  assert.match(h.status('data'),/прочитать/);
  assert.equal(h.hasResult('data'),false);
  assert.equal(h.controlsDisabled(),false);
  await h.setFiles('data-folder',[directoryFile('a/x','fixed')]);
  await h.submit('data');
  assert.equal(h.entries('data').length,1,h.status('data'));
  h.unload();
});

test('unsupported folder picker keeps regular file encryption available', async () => {
  const h = createAppHarness({directorySupport:false});
  assert.equal(h.nodes.get('data-folder-option').disabled,true);
  assert.equal(h.nodes.get('hide-folder-option').disabled,true);
  await h.setFiles('data-file',[new File(['x'],'x.txt')]);
  await h.setValue('data-password','secret');
  await h.submit('data');
  assert.equal(h.entries('data').length,1,h.status('data'));
  h.unload();
});

test('source mode change clears selected files so the user must choose the new source', async () => {
  const h = createAppHarness();
  await h.setFiles('data-file',[new File(['x'],'old.txt')]);
  await selectFolder(h,'data',[directoryFile('a/x','hi')]);
  await h.setValue('data-source-kind','file','change');
  await h.submit('data');
  assert.equal(h.hasResult('data'),false);
  assert.match(h.status('data'),/Выберите файл/);
});
