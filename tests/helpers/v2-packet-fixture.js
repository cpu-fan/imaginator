const {pbkdf2Sync,createCipheriv} = require('node:crypto');
const salt=Buffer.from('000102030405060708090a0b0c0d0e0f','hex');
const iv=Buffer.from('101112131415161718191a1b','hex');
const key=pbkdf2Sync('interop',salt,310000,32,'sha256');
function makeV2Packet(info,bytes,overrides={}) {
 const name=Buffer.from(overrides.nameBytes || Buffer.from(info.name)),type=Buffer.from(overrides.typeBytes || Buffer.from(info.type));
 const plain=Buffer.alloc(40+name.length+type.length+bytes.length);
 plain.writeUInt16BE(name.length,0);plain.writeUInt16BE(type.length,2);plain.writeUInt32BE(info.length,4);
 Buffer.from(info.setId,'hex').copy(plain,8);
 for (const [field,offset] of [['index',24],['count',28],['totalSize',32],['offset',36]]) plain.writeUInt32BE(info[field],offset);
 name.copy(plain,40);type.copy(plain,40+name.length);Buffer.from(bytes).copy(plain,40+name.length+type.length);
 const header=Buffer.alloc(37);header.write('FVLT');header[4]=2;header.writeUInt32BE(plain.length+16,5);salt.copy(header,9);iv.copy(header,25);
 const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(header);
 return new Uint8Array(Buffer.concat([header,cipher.update(plain),cipher.final(),cipher.getAuthTag()]));
}
module.exports={makeV2Packet};
