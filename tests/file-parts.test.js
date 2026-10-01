const test = require('node:test');
const assert = require('node:assert/strict');
let Parts;
try { Parts = require('../file-parts.js'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; Parts = {}; }
const MiB = 1048576;
const id = '000102030405060708090a0b0c0d0e0f';
const part = (overrides = {}) => ({setId:id,name:'original.bin',type:'application/octet-stream',index:0,count:2,totalSize:7,offset:0,length:3,...overrides});
const failure = (code, details) => error => error.code === code && (!details || JSON.stringify(error.details) === JSON.stringify(details));

test('count balances 37 MiB into four parts', () => assert.deepEqual(Parts.planParts(37*MiB,{mode:'count',count:4}).map(p=>p.length), [9699328,9699328,9699328,9699328]));
test('size allows 20 MiB parts', () => assert.deepEqual(Parts.planParts(37*MiB,{mode:'size',partSize:20*MiB}), [{index:0,offset:0,length:20971520},{index:1,offset:20971520,length:17825792}]));
test('count places remainder in first parts', () => assert.deepEqual(Parts.planParts(7,{mode:'count',count:3}), [{index:0,offset:0,length:3},{index:1,offset:3,length:2},{index:2,offset:5,length:2}]));
test('size divides exactly and accepts a size larger than source', () => {
 assert.deepEqual(Parts.planParts(6,{mode:'size',partSize:3}).map(p=>p.length),[3,3]);
 assert.deepEqual(Parts.planParts(6,{mode:'size',partSize:20}),[{index:0,offset:0,length:6}]);
});
test('decimal sizes accept separators and floor bytes', () => {
 for (const input of ['2.5','2,5',' 2,5 ']) assert.equal(Parts.parsePartSize(input,'MiB'),2621440);
 assert.equal(Parts.parsePartSize('0.001','KiB'),1);
 assert.equal(Parts.parsePartSize('64','MiB'),67108864);
});
test('empty source produces one empty part in each mode', () => {
 for (const options of [{mode:'single'},{mode:'count',count:1},{mode:'size',partSize:3}]) assert.deepEqual(Parts.planParts(0,options),[{index:0,offset:0,length:0}]);
 assert.throws(()=>Parts.planParts(0,{mode:'count',count:2}),failure('INVALID_SPLIT'));
});
test('inclusive safety boundaries permit valid plans', () => {
 assert.equal(Parts.planParts(64*MiB,{mode:'single'})[0].length,67108864);
 assert.equal(Parts.planParts(512*MiB,{mode:'count',count:8}).length,8);
 assert.equal(Parts.planParts(1000,{mode:'count',count:1000}).length,1000);
});
test('invalid source sizes and split options are rejected', () => {
 for (const size of [-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER,512*MiB+1]) assert.throws(()=>Parts.planParts(size,{mode:'single'}),failure('INVALID_SPLIT'));
 for (const options of [{mode:'count',count:0},{mode:'count',count:1.5},{mode:'count',count:8},{mode:'count',count:1001},{mode:'size',partSize:0},{mode:'size',partSize:1.5},{mode:'size',partSize:64*MiB+1},{mode:'unknown'},null]) assert.throws(()=>Parts.planParts(7,options),failure('INVALID_SPLIT'));
 assert.throws(()=>Parts.planParts(64*MiB+1,{mode:'single'}),failure('INVALID_SPLIT'));
 assert.throws(()=>Parts.planParts(129*MiB,{mode:'count',count:2}),failure('INVALID_SPLIT'));
 assert.throws(()=>Parts.planParts(1001,{mode:'size',partSize:1}),failure('INVALID_SPLIT'));
});
test('invalid decimal inputs and units are rejected', () => {
 for (const input of ['', ' ', '0', '-1', 'NaN', 'Infinity', '1e2','2.5.3','2,5.3','1 000','0.0001','64.1']) assert.throws(()=>Parts.parsePartSize(input,input==='0.0001'?'KiB':'MiB'),failure('INVALID_SPLIT'));
 assert.throws(()=>Parts.parsePartSize('2','MB'),failure('INVALID_SPLIT'));
});
test('validation orders the set without mutating records or input', () => {
 const first=part({bytes:Uint8Array.of(0,1,2)}),second=part({index:1,offset:3,length:4,bytes:Uint8Array.of(3,4,5,6)});
 const input=[second,first]; assert.deepEqual(Parts.validateSet(input),[first,second]); assert.deepEqual(input,[second,first]);
});
test('missing parts expose their one-based numbers', () => assert.throws(()=>Parts.validateSet([part()]),failure('MISSING_PARTS',{numbers:[2]})));
test('duplicate parts expose their one-based number', () => assert.throws(()=>Parts.validateSet([part(),part()]),failure('DUPLICATE_PART',{number:1})));
test('different IDs and inconsistent metadata reject mixed sets', () => {
 for (const changed of [{setId:'f'.repeat(32)},{name:'another.bin'},{type:'text/plain'},{count:3},{totalSize:8}]) assert.throws(()=>Parts.validateSet([part(),part({index:1,offset:3,length:4,...changed})]),failure('MIXED_SETS'));
});
test('gaps overlaps and wrong total are rejected', () => {
 for (const second of [part({index:1,offset:4,length:3}),part({index:1,offset:2,length:4}),part({index:1,offset:3,length:3})]) assert.throws(()=>Parts.validateSet([part(),second]),failure('INVALID_RANGES'));
});
test('part metadata rejects invalid lengths counts IDs and positions', () => {
 for (const changed of [{setId:'bad'},{index:2},{index:-1},{count:0},{count:1001},{totalSize:512*MiB+1},{length:64*MiB+1},{length:0},{offset:6},{offset:-1},{index:0.5},{name:1},{type:null},{totalSize:0},{length:NaN}]) assert.throws(()=>Parts.validatePart(part(changed)),failure('INVALID_PART'));
 assert.throws(()=>Parts.validateSet([]),failure('INVALID_PART'));
});
test('an empty file set retains its metadata', () => {
 const empty=part({count:1,totalSize:0,offset:0,length:0});
 assert.deepEqual(Parts.validateSet([empty]),[empty]);
});
