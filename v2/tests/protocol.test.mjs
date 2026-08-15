import test from 'node:test';
import assert from 'node:assert/strict';
import { generateIdentity, exportPublicIdentity, utf8 } from '../client/crypto/webcrypto.js';
import { sealMessage, openMessage } from '../client/crypto/message.js';
import { encodeCiphertext, decodeCiphertext } from '../client/tango/codec.js';
import { encryptAttachment, decryptAttachment } from '../client/media/attachments.js';

// Node 20 exposes Web Crypto globally.
const corpus=[{titulo:'test',versos:Array.from({length:32},(_,i)=>({palabras:Array.from({length:10},(_,j)=>`w${i*10+j}`)}))}];

async function keyPair(){
 const id=await generateIdentity();
 return {id,pub:await exportPublicIdentity(id)};
}

test('Tango codec roundtrip exact bytes', async()=>{
 const a=await crypto.subtle.digest('SHA-256',utf8('clave'));
 const key=new Uint8Array(a);
 const original=crypto.getRandomValues(new Uint8Array(64));
 const encoded=await encodeCiphertext(original,key,corpus);
 const decoded=await decodeCiphertext(encoded,key,corpus);
 assert.deepEqual([...decoded],[...original]);
});

test('message roundtrip', async()=>{
 const alice=await keyPair(), bob=await keyPair();
 const payload=utf8('Mensaje de prueba con Ñ, áéíóú y formato separado.');
 const env=await sealMessage({sender:alice.id,recipientReceivingJwk:bob.pub.receiving,senderDeviceId:'alice-1',recipientDeviceId:'bob-1',payload,type:'text',corpus});
 const plain=await openMessage({recipient:bob.id,senderSigningJwk:alice.pub.signing,envelope:env,corpus});
 assert.equal(new TextDecoder().decode(plain),new TextDecoder().decode(payload));
});

test('tampering fails', async()=>{
 const alice=await keyPair(), bob=await keyPair();
 const env=await sealMessage({sender:alice.id,recipientReceivingJwk:bob.pub.receiving,senderDeviceId:'alice-1',recipientDeviceId:'bob-1',payload:utf8('x'),corpus});
 env.tango=env.tango.replace(/.$/,'x');
 await assert.rejects(()=>openMessage({recipient:bob.id,senderSigningJwk:alice.pub.signing,envelope:env,corpus}));
});

test('attachment bytes survive exact roundtrip', async()=>{
 const key=crypto.getRandomValues(new Uint8Array(32));
 const original=new Uint8Array(2_500_000); for(let i=0;i<original.length;i+=65536) crypto.getRandomValues(original.subarray(i,Math.min(i+65536,original.length)));
 const e=await encryptAttachment({bytes:original,attachmentKey:key,attachmentId:'att-1'});
 const out=await decryptAttachment({chunks:e.chunks,attachmentKey:key,attachmentId:'att-1',chunkCount:e.count});
 assert.deepEqual([...out],[...original]);
});
