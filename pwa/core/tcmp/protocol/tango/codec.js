import { utf8 } from '../crypto/webcrypto.js';

async function digest(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const data = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { data.set(part, offset); offset += part.length; }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

function hex(bytes) { return [...bytes].map(x => x.toString(16).padStart(2, '0')).join(''); }

function corpusWords(corpus) {
  const words = [];
  const add = word => {
    if (typeof word !== 'string') return;
    const w = word.trim();
    if (w && !words.includes(w)) words.push(w);
  };
  const entries = Array.isArray(corpus) ? corpus.entries() : Object.entries(corpus || {}).filter(([k]) => !k.startsWith('_'));
  for (const [, tango] of entries) {
    for (const verse of tango?.versos || []) {
      if (Array.isArray(verse)) verse.forEach(add);
      else if (Array.isArray(verse?.palabras)) verse.palabras.forEach(add);
    }
  }
  if (words.length < 256) throw new Error(`El corpus Tango necesita al menos 256 palabras únicas; hay ${words.length}`);
  return words.slice(0, 256);
}

async function permutation(key, corpus) {
  const words = corpusWords(corpus);
  const pairs = [];
  for (let i = 0; i < 256; i++) {
    const h = hex(await digest([key, utf8('TCMP-TANGO-PERM-v1'), utf8(String(i))]));
    pairs.push({ i, h });
  }
  pairs.sort((a, b) => a.h.localeCompare(b.h));
  const p = new Uint16Array(256);
  pairs.forEach((item, rank) => { p[item.i] = rank; });
  return { words, p };
}

/**
 * TCMP Tango Codec.
 *
 * The AEAD remains the cryptographic confidentiality/authentication layer.
 * This codec is keyed: the session-derived Tango key determines the
 * permutation that maps ciphertext bytes to corpus words. Thus the corpus
 * is part of the keyed transformation rather than decorative formatting.
 */
export async function encodeCiphertext(ciphertext, key, corpus) {
  const { words, p } = await permutation(key, corpus);
  return `TC1.${[...ciphertext].map(byte => words[p[byte]]).join(' ')}`;
}

export async function decodeCiphertext(encoded, key, corpus) {
  if (typeof encoded !== 'string' || !encoded.startsWith('TC1.')) throw new Error('Código Tango TCMP inválido');
  const { words, p } = await permutation(key, corpus);
  const reverse = new Map();
  for (let byte = 0; byte < 256; byte++) reverse.set(words[p[byte]], byte);
  const body = encoded.slice(4).trim();
  const tokens = body ? body.split(/\s+/) : [];
  const out = new Uint8Array(tokens.length);
  tokens.forEach((token, index) => {
    const value = reverse.get(token);
    if (value === undefined) throw new Error(`Palabra Tango desconocida en posición ${index}`);
    out[index] = value;
  });
  return out;
}
