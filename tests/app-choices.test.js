const test = require('node:test');
const assert = require('node:assert/strict');
const {createAppHarness} = require('./helpers/app-harness.js');
const {directoryFile} = require('./helpers/directory-file.js');

test('visible choices use native radio groups and retain the initial file and single PNG modes', () => {
  const h = createAppHarness();
  for (const id of ['hide-source-kind','data-source-kind','data-split-mode']) {
    const group = h.nodes.get(id);
    assert.equal(group.tagName,'FIELDSET','Expected a native choice group: '+id);
    assert.equal(group.querySelectorAll('input[type=radio]').filter(input=>input.checked).length,1);
    assert.ok(group.querySelector('legend').textContent.trim());
  }
  assert.equal(h.nodes.get('data-pack-single').checked,true);
  assert.equal(h.nodes.get('data-source-file').checked,true);
  assert.equal(h.nodes.get('hide-source-file').checked,true);
});

test('packaging cards reveal their settings and encrypt using the selected choice', async () => {
  const h = createAppHarness();
  assert.equal(h.nodes.get('data-split-mode').tagName,'FIELDSET');
  await h.setFiles('data-file',[new File([new Uint8Array(2048)],'sample.bin')]);
  await h.setValue('data-password','secret');
  await h.setValue('data-split-mode','count','change');
  await h.setValue('data-part-count','4');
  assert.equal(h.nodes.get('data-count-field').hidden,false);
  assert.equal(h.nodes.get('data-size-field').hidden,true);
  await h.submit('data');
  assert.equal(h.entries('data').length,4,h.status('data'));
  const urls=[...h.activeUrls.keys()];
  await h.setValue('data-split-mode','size','change');
  assert.equal(h.nodes.get('data-count-field').hidden,true);
  assert.equal(h.nodes.get('data-size-field').hidden,false);
  assert.equal(h.nodes.get('data-part-count').disabled,true);
  assert.equal(h.nodes.get('data-part-size').disabled,false);
  assert.ok(urls.every(url=>h.revokedUrls.has(url)));
  await h.setValue('data-part-unit','KiB','change');
  await h.setValue('data-part-size','1');
  await h.submit('data');
  assert.equal(h.entries('data').length,2,h.status('data'));
  await h.setValue('data-split-mode','single','change');
  assert.equal(h.nodes.get('data-size-field').hidden,true);
  await h.submit('data');
  assert.equal(h.entries('data')[0].name,'sample.png');
  h.unload();
});

test('unsupported folder choice stays disabled after regular file encryption',async()=>{
  const h=createAppHarness({directorySupport:false});
  assert.equal(h.nodes.get('data-source-kind').tagName,'FIELDSET');
  await h.setFiles('data-file',[new File(['x'],'sample.txt')]);
  await h.setValue('data-password','secret');
  await h.submit('data');
  assert.equal(h.entries('data').length,1,h.status('data'));
  assert.equal(h.nodes.get('data-folder-option').disabled,true);
  assert.equal(h.nodes.get('hide-folder-option').disabled,true);
  h.unload();
});

test('radio source choice uses the folder and clears its selection when returning to a file',async()=>{
  const h=createAppHarness();
  assert.equal(h.nodes.get('data-source-kind').tagName,'FIELDSET');
  await h.setValue('data-source-kind','folder','change');
  await h.setFiles('data-folder',[directoryFile('docs/a.txt','x')]);
  await h.setValue('data-password','secret');
  await h.submit('data');
  assert.equal(h.entries('data')[0].name,'docs.png');
  await h.setValue('data-source-kind','file','change');
  assert.equal(h.hasResult('data'),false);
  assert.equal(h.nodes.get('data-folder').files.length,0);
  await h.submit('data');
  assert.equal(h.hasResult('data'),false);
  assert.match(h.status('data'),/Выберите файл/);
  h.unload();
});
