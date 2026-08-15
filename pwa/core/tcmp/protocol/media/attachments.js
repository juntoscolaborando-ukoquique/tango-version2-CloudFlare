import { aesGcmDecrypt, aesGcmEncrypt, b64, hkdf, sha256, unb64, utf8 } from '../crypto/webcrypto.js';

export const DEFAULT_CHUNK = 1024 * 1024; // 1 MiB
export async function deriveAttachmentKey(baseKey, attachmentId) {
  return hkdf(baseKey, new Uint8Array(32), `TCMP-A1-key-${attachmentId}`, 32);
}

export async function prepareAttachment(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = await sha256(bytes);
  return {bytes,meta:{filename:file.name,mime:file.type || 'application/octet-stream',size:bytes.byteLength,sha256:b64(digest)}};
}

export async function encryptAttachment({bytes,attachmentKey,attachmentId,chunkSize=DEFAULT_CHUNK}) {
  const chunks=[]; const count=Math.ceil(bytes.length/chunkSize)||1;
  for(let i=0;i<count;i++) {
    const plain=bytes.slice(i*chunkSize, Math.min(bytes.length,(i+1)*chunkSize));
    const aad=utf8(`TCMP-A1|${attachmentId}|${i}|${count}`);
    const enc=await aesGcmEncrypt(attachmentKey,plain,aad);
    chunks.push({index:i,nonce:b64(enc.nonce),ciphertext:b64(enc.ciphertext)});
  }
  return {count,chunks};
}

export async function decryptAttachment({chunks,attachmentKey,attachmentId,chunkCount}) {
  const ordered=[...chunks].sort((a,b)=>a.index-b.index);
  if(ordered.length!==chunkCount) throw new Error('Faltan chunks del adjunto');
  const parts=[];
  for(const c of ordered) {
    const aad=utf8(`TCMP-A1|${attachmentId}|${c.index}|${chunkCount}`);
    parts.push(await aesGcmDecrypt(attachmentKey,unb64(c.nonce),unb64(c.ciphertext),aad));
  }
  const total=parts.reduce((n,p)=>n+p.length,0), out=new Uint8Array(total); let o=0;
  for(const p of parts){out.set(p,o);o+=p.length;}
  return out;
}
