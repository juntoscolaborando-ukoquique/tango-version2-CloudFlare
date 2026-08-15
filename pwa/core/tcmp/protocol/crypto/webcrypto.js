const te = new TextEncoder();
const td = new TextDecoder();

export const utf8 = (s) => te.encode(s);
export const text = (b) => td.decode(b);
export function b64(bytes) { let s=''; const step=0x8000; for(let i=0;i<bytes.length;i+=step) s += String.fromCharCode(...bytes.subarray(i,i+step)); return btoa(s); }
export const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

export async function hkdf(sharedSecret, salt, info, length = 32) {
  const base = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'HKDF', hash: 'SHA-256', salt, info: utf8(info)
  }, base, length * 8);
  return new Uint8Array(bits);
}

export async function aesGcmEncrypt(keyBytes, plaintext, aad = new Uint8Array()) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv:nonce, additionalData:aad, tagLength:128}, key, plaintext));
  return { nonce, ciphertext };
}

export async function aesGcmDecrypt(keyBytes, nonce, ciphertext, aad = new Uint8Array()) {
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM', iv:nonce, additionalData:aad, tagLength:128}, key, ciphertext));
}

export async function generateIdentity() {
  const signing = await crypto.subtle.generateKey({name:'ECDSA', namedCurve:'P-256'}, true, ['sign','verify']);
  const receiving = await crypto.subtle.generateKey({name:'ECDH', namedCurve:'P-256'}, true, ['deriveBits']);
  return { signing, receiving };
}

export async function exportPublicIdentity(identity) {
  return {
    signing: await crypto.subtle.exportKey('jwk', identity.signing.publicKey),
    receiving: await crypto.subtle.exportKey('jwk', identity.receiving.publicKey)
  };
}

export async function exportPrivateIdentity(identity) {
  return {
    signing: await crypto.subtle.exportKey('jwk', identity.signing.privateKey),
    receiving: await crypto.subtle.exportKey('jwk', identity.receiving.privateKey)
  };
}

export async function importPrivateIdentity(raw) {
  const sp = await crypto.subtle.importKey('jwk', raw.signing, {name:'ECDSA', namedCurve:'P-256'}, true, ['sign']);
  const spub = await crypto.subtle.importKey('jwk', {...raw.signing, d:undefined, key_ops:['verify']}, {name:'ECDSA', namedCurve:'P-256'}, true, ['verify']).catch(async()=>null);
  const rp = await crypto.subtle.importKey('jwk', raw.receiving, {name:'ECDH', namedCurve:'P-256'}, true, ['deriveBits']);
  return { signing:{privateKey:sp, publicKey:spub}, receiving:{privateKey:rp, publicKey:null} };
}

export async function importPublicReceiving(jwk) {
  return crypto.subtle.importKey('jwk', jwk, {name:'ECDH', namedCurve:'P-256'}, true, []);
}
export async function importPublicSigning(jwk) {
  return crypto.subtle.importKey('jwk', jwk, {name:'ECDSA', namedCurve:'P-256'}, true, ['verify']);
}

export async function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+canonicalJson(value[k])).join(',') + '}';
}

export async function sign(identity, bytes) {
  return new Uint8Array(await crypto.subtle.sign({name:'ECDSA', hash:'SHA-256'}, identity.signing.privateKey, bytes));
}
export async function verify(publicKey, signature, bytes) {
  return crypto.subtle.verify({name:'ECDSA', hash:'SHA-256'}, publicKey, signature, bytes);
}
