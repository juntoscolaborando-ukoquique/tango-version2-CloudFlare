import { aesGcmDecrypt, aesGcmEncrypt, b64, canonicalJson, hkdf, importPublicReceiving, importPublicSigning, sign, unb64, utf8, verify } from './webcrypto.js';
import { encodeCiphertext, decodeCiphertext } from '../tango/codec.js';

async function derive(ephemeralPrivate, recipientPublic, salt, info) {
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: recipientPublic }, ephemeralPrivate, 256);
  const shared = new Uint8Array(bits);
  return {
    payload: await hkdf(shared, salt, `${info}-payload`, 32),
    tango: await hkdf(shared, salt, `${info}-tango`, 32)
  };
}

export async function sealMessage({ sender, recipientReceivingJwk, senderDeviceId, recipientDeviceId, payload, type = 'text', corpus, messageId = crypto.randomUUID(), chunkIndex = 0, chunkCount = 1 }) {
  const recipientPublic = await importPublicReceiving(recipientReceivingJwk);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const ephJwk = await crypto.subtle.exportKey('jwk', eph.publicKey);
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const aadObject = { v: 1, type, senderDeviceId, recipientDeviceId, messageId, chunkIndex, chunkCount };
  const aad = utf8(await canonicalJson(aadObject));
  const keys = await derive(eph.privateKey, recipientPublic, salt, 'TCMP-v1-message');
  const enc = await aesGcmEncrypt(keys.payload, payload, aad);
  const tango = await encodeCiphertext(enc.ciphertext, keys.tango, corpus);
  const unsigned = { v: 1, type, senderDeviceId, recipientDeviceId, messageId, chunkIndex, chunkCount, eph: ephJwk, salt: b64(salt), nonce: b64(enc.nonce), tango };
  const signature = await sign(sender, utf8(await canonicalJson(unsigned)));
  return { ...unsigned, signature: b64(signature) };
}

export async function openMessage({ recipient, senderSigningJwk, envelope, corpus }) {
  if (envelope.v !== 1) throw new Error('Versión TCMP no soportada');
  const senderPublic = await importPublicSigning(senderSigningJwk);
  const { signature, ...unsigned } = envelope;
  const valid = await verify(senderPublic, unb64(signature), utf8(await canonicalJson(unsigned)));
  if (!valid) throw new Error('Firma de mensaje inválida');
  const eph = await crypto.subtle.importKey('jwk', envelope.eph, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: eph }, recipient.receiving.privateKey, 256);
  const shared = new Uint8Array(bits);
  const payloadKey = await hkdf(shared, unb64(envelope.salt), 'TCMP-v1-message-payload', 32);
  const tangoKey = await hkdf(shared, unb64(envelope.salt), 'TCMP-v1-message-tango', 32);
  const cipher = await decodeCiphertext(envelope.tango, tangoKey, corpus);
  const aad = utf8(await canonicalJson({ v: 1, type: envelope.type, senderDeviceId: envelope.senderDeviceId, recipientDeviceId: envelope.recipientDeviceId, messageId: envelope.messageId, chunkIndex: envelope.chunkIndex, chunkCount: envelope.chunkCount }));
  return aesGcmDecrypt(payloadKey, unb64(envelope.nonce), cipher, aad);
}
