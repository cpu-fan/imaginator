const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const Core=require('../vault-core.js');
const {makeV2Packet}=require('./helpers/v2-packet-fixture.js');
const info={setId:'000102030405060708090a0b0c0d0e0f',name:'猫.bin',type:'application/octet-stream',index:0,count:1,totalSize:3,offset:0,length:3};
const input=(extra={})=>({name:'sample.bin',type:'application/octet-stream',index:0,count:1,totalSize:3,offset:0,bytes:Uint8Array.of(0,42,255),...extra});
function browserCore() {
 let derivations=0,ivCalls=0;
 const crypto={getRandomValues(array){if(array.length===12){ivCalls++;array.fill(ivCalls<=2?7:8);return array;}return webcrypto.getRandomValues(array);},subtle:new Proxy(webcrypto.subtle,{get(target,key){if(key==='deriveKey')return (...args)=>{derivations++;return target.deriveKey(...args);};const value=target[key];return typeof value==='function'?value.bind(target):value;}})};
 const context=vm.createContext({TextEncoder,TextDecoder,Uint8Array,crypto});
 for(const file of ['file-parts.js','vault-core.js'])vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'..',file),'utf8'),context);
 return {core:context.VaultCore,derivations:()=>derivations,ivCalls:()=>ivCalls};
}
test('decrypts independent v2 fixture including Unicode and metadata',async()=>{
 const result=await Core.createDecryptSession('interop').decryptPacket(makeV2Packet(info,Uint8Array.of(0,42,255)));
 assert.deepEqual(result,{version:2,...info,bytes:Uint8Array.of(0,42,255)});
});
test('new v2 packets preserve exact envelope and independent part metadata',async()=>{
 const session=await Core.createEncryptSession('secret');const packet=await session.encryptPart(input());
 assert.deepEqual([...packet.slice(0,5)],[70,86,76,84,2]);assert.equal(new DataView(packet.buffer).getUint32(5),packet.length-37);
 assert.equal(packet.length,130);
 const decoded=await Core.createDecryptSession('secret').decryptPacket(packet);
 assert.deepEqual([...decoded.bytes],[0,42,255]);assert.equal(decoded.length,3);assert.equal(decoded.totalSize,3);assert.equal(decoded.name,'sample.bin');
});
test('one session shares salt and ID and uses different IVs',async()=>{
 const session=await Core.createEncryptSession('secret');const first=await session.encryptPart(input({count:2,totalSize:6})),second=await session.encryptPart(input({count:2,totalSize:6,index:1,offset:3}));
 assert.deepEqual(first.slice(9,25),second.slice(9,25));assert.notDeepEqual(first.slice(25,37),second.slice(25,37));
 const dec=Core.createDecryptSession('secret');const a=await dec.decryptPacket(first),b=await dec.decryptPacket(second);assert.equal(a.setId,b.setId);
 const other=await Core.createEncryptSession('secret');const c=await dec.decryptPacket(await other.encryptPart(input()));assert.notEqual(a.setId,c.setId);
});
test('v2 supports 11 MiB data and an empty Unicode-named file',async()=>{
 const bytes=new Uint8Array(11*1048576);bytes[0]=255;bytes[bytes.length-1]=42;
 const session=await Core.createEncryptSession('secret'),dec=Core.createDecryptSession('secret');
 const large=await dec.decryptPacket(await session.encryptPart(input({bytes,totalSize:bytes.length})));assert.deepEqual(large.bytes,bytes);
 const empty=await dec.decryptPacket(await session.encryptPart(input({name:'空🖼️.txt',bytes:new Uint8Array(),totalSize:0})));
 assert.equal(empty.name,'空🖼️.txt');assert.equal(empty.length,0);
});
test('decrypt session preserves legacy packet support',async()=>{
 const file={name:'old.bin',type:'',bytes:Uint8Array.of(7)};
 const packet=await Core.encryptFile(file,'secret');assert.deepEqual(await Core.createDecryptSession('secret').decryptPacket(packet),{version:1,...file});
});
test('v2 rejects blank and wrong passwords and modified envelopes',async()=>{
 await assert.rejects(Core.createEncryptSession(' '));assert.throws(()=>Core.createDecryptSession(' '));
 const packet=makeV2Packet(info,Uint8Array.of(0,42,255));await assert.rejects(Core.createDecryptSession('wrong').decryptPacket(packet));
 for(const index of [0,4,8,9,25,37,packet.length-1]){const bad=packet.slice();bad[index]^=1;await assert.rejects(Core.createDecryptSession('interop').decryptPacket(bad));}
 await assert.rejects(Core.createDecryptSession('interop').decryptPacket(packet.slice(0,-1)));
});
test('independently encrypted invalid metadata is rejected',async()=>{
 const session=Core.createDecryptSession('interop');
 for(const changed of [{index:1},{count:0},{count:1001},{totalSize:536870913},{offset:2},{length:0},{length:2}])await assert.rejects(session.decryptPacket(makeV2Packet({...info,...changed},Uint8Array.of(0,42,255))));
 await assert.rejects(session.decryptPacket(makeV2Packet(info,Uint8Array.of(0,42,255),{nameBytes:Uint8Array.of(255)})));
});
test('oversized packets are rejected before deriving a key',async()=>{
 const spy=browserCore();const bad=new Uint8Array(37+40+65535+65535+67108864+16+1);bad.set([70,86,76,84,2]);new DataView(bad.buffer).setUint32(5,bad.length-37);
 await assert.rejects(spy.core.createDecryptSession('secret').decryptPacket(bad));assert.equal(spy.derivations(),0);
});
test('sessions derive once and regenerate a colliding IV',async()=>{
 const spy=browserCore(),session=await spy.core.createEncryptSession('secret');
 const a=await session.encryptPart(input({count:2,totalSize:6})),b=await session.encryptPart(input({count:2,totalSize:6,index:1,offset:3}));
 assert.notDeepEqual(a.slice(25,37),b.slice(25,37));assert.equal(spy.ivCalls(),3);assert.equal(spy.derivations(),1);
 const dec=spy.core.createDecryptSession('secret');await dec.decryptPacket(a);await dec.decryptPacket(b);assert.equal(spy.derivations(),2);
});
