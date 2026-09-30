const test=require('node:test'),assert=require('node:assert/strict');
const {createAppHarness}=require('./helpers/app-harness.js');
async function configured(h){await h.setFiles('data-file',[new File([Uint8Array.of(0,1,2,3,4,5,6)],'sample.bin',{type:'application/octet-stream'})]);await h.setValue('data-password','secret');await h.setValue('data-split-mode','count','change');await h.setValue('data-part-count','3');}
test('preview supports count size decimal units and invalid parameters',async()=>{
 const h=createAppHarness();assert.equal(h.nodes.get('data-split-mode').value,'single');assert.equal(h.nodes.get('data-count-field').hidden,true);assert.equal(h.nodes.get('data-size-field').hidden,true);
 await h.setFiles('data-file',[{name:'large.bin',size:37*1048576}]);await h.setValue('data-split-mode','count','change');assert.match(h.nodes.get('data-split-summary').textContent,/4/);assert.match(h.nodes.get('data-split-summary').textContent,/9,25/);
 await h.setValue('data-split-mode','size','change');await h.setValue('data-part-size','20');assert.match(h.nodes.get('data-split-summary').textContent,/17/);assert.match(h.nodes.get('data-split-summary').textContent,/20/);
 await h.setFiles('data-file',[{name:'small.bin',size:2048}]);await h.setValue('data-part-size','0,5');await h.setValue('data-part-unit','KiB','change');assert.match(h.nodes.get('data-split-summary').textContent,/4/);
 await h.setValue('data-password','secret');await h.setValue('data-part-count','0');await h.setValue('data-split-mode','count','change');await h.submit('data');assert.equal(h.hasResult('data'),false);assert.match(h.status('data'),/част/);
});
test('creation slices data sequentially and publishes only a complete set',async()=>{
 let sessions=0,active=0,max=0;const slices=[];
 const h=createAppHarness({vaultCore:core=>({...core,async createEncryptSession(password){sessions++;const session=await core.createEncryptSession(password);return {async encryptPart(part){active++;max=Math.max(max,active);assert.equal(h.hasResult('data'),false);const result=await session.encryptPart(part);active--;return result;}};}})});
 class Source extends File {arrayBuffer(){throw new Error('Whole source read');}slice(start,end){slices.push([start,end]);return super.slice(start,end);}}
 await h.setFiles('data-file',[new Source([Uint8Array.of(0,1,2,3,4,5,6)],'sample.bin')]);await h.setValue('data-password','secret');await h.setValue('data-split-mode','count','change');await h.setValue('data-part-count','3');await h.submit('data');
 assert.deepEqual(slices,[[0,3],[3,5],[5,7]]);assert.equal(sessions,1);assert.equal(max,1);assert.deepEqual(h.entries('data').map(e=>e.name),['sample.part-001-of-003.png','sample.part-002-of-003.png','sample.part-003-of-003.png']);assert.equal(h.entries('data').every(e=>e.blob.type==='image/png'),true);h.unload();assert.equal(h.activeUrls.size,0);
});
test('single output keeps its name and 1000 parts use four digits',async()=>{
 const h=createAppHarness();await configured(h);await h.setValue('data-split-mode','single','change');await h.submit('data');assert.equal(h.entries('data')[0].name,'sample-данные.png');
 await h.setFiles('data-file',[new File([new Uint8Array(1000)],'sample.bin')]);await h.setValue('data-split-mode','count','change');await h.setValue('data-part-count','1000');await h.submit('data');assert.equal(h.entries('data')[0].name,'sample.part-0001-of-1000.png');assert.equal(h.entries('data')[999].name,'sample.part-1000-of-1000.png');h.unload();assert.equal(h.activeUrls.size,0);
});
for(const id of ['data-password','data-split-mode','data-part-count','data-part-size','data-part-unit'])test('changing '+id+' revokes every output URL',async()=>{
 const h=createAppHarness();await configured(h);await h.submit('data');const urls=[...h.activeUrls.keys()];assert.equal(urls.length,3);await h.setValue(id,id==='data-split-mode'?'size':'2',id==='data-split-mode'||id==='data-part-unit'?'change':'input');assert.equal(h.activeUrls.size,0);assert.equal(h.hasResult('data'),false);assert.equal(urls.every(u=>h.revokedUrls.has(u)),true);
});
test('source and tab changes clear all old downloads',async()=>{
 const h=createAppHarness();await configured(h);await h.submit('data');await h.setFiles('data-file',[new File(['x'],'new.bin')]);assert.equal(h.activeUrls.size,0);await h.setValue('data-part-count','1');await h.submit('data');assert.equal(h.entries('data').length,1);await h.dispatch('tab-extract','click');assert.equal(h.activeUrls.size,0);assert.equal(h.hasResult('data'),false);
});
for(const faults of [{nullAt:2},{throwAt:2},{urlAt:2}])test('failed result creation clears everything and permits retry '+JSON.stringify(faults),async()=>{
 const h=createAppHarness({faults});await configured(h);await h.submit('data');assert.equal(h.hasResult('data'),false);assert.equal(h.activeUrls.size,0);assert.equal(h.controlsDisabled(),false);await h.submit('data');assert.equal(h.entries('data').length,3);h.unload();
});
test('busy operation disables selects and prevents a second submit',async()=>{
 let release,started;const barrier=new Promise(r=>release=r),start=new Promise(r=>started=r);let sessions=0;
 const h=createAppHarness({vaultCore:core=>({...core,async createEncryptSession(p){sessions++;started();await barrier;return core.createEncryptSession(p);}})});await configured(h);const operation=h.submit('data');await start;assert.equal(h.controlsDisabled(),true);await h.submit('data');assert.equal(sessions,1);release();await operation;assert.equal(h.controlsDisabled(),false);h.unload();
});
test('filenames render as text rather than markup',async()=>{
 const h=createAppHarness();await h.setFiles('data-file',[new File(['x'],'<img onerror=boom>.bin')]);await h.setValue('data-password','secret');await h.submit('data');assert.equal(h.hasResult('data'),true);assert.equal(h.nodes.get('data-results').querySelectorAll('img').length,0);assert.match(h.nodes.get('data-results').textContent,/<img onerror=boom>/);h.unload();
});
