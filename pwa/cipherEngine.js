// NOTE: "salt" in this module refers to the numeric offset added to the tango ID
// to mask it in the ciphertext (e.g. tango 3 + salt 47 = masked key 50).
// This is unrelated to a KDF salt (random bytes used to derive a cryptographic key).
// Both concepts appear in this codebase — the KDF salt lives in secure-vault.js
// and build_encrypted_bundle.py (Python side).
//
// In production, salt must come from the decrypted bundle (IndexedDB), never from
// committed source. The real security of the system relies on keeping tangos.json private.

/**
 * Token format:
 *   V01P02        — word found in corpus, lowercase
 *   V01P02^C      — first letter capitalized
 *   V01P02^U      — all uppercase
 *   #hexval       — PBKDF2-derived keystream fallback, lowercase
 *   #hexval^C/^U  — fallback with case flag
 *   ~2c           — non-letter character (punctuation, space) as hex
 */

/**
 * Derives a per-token keystream using PBKDF2-HMAC-SHA256.
 * Each token gets a unique keystream based on its position (tokenIndex),
 * making brute-force require knowing both SALT and token position.
 */
const FALLBACK_KDF_ITERATIONS = 10000;

async function deriveKeystream(salt, tokenIndex, length, context) {
  const enc = new TextEncoder();
  const saltText = String(salt);
  const contextText = context ?? saltText;
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(saltText),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: enc.encode(`${contextText}:${tokenIndex}`),
      iterations: FALLBACK_KDF_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    length * 8
  );
  return new Uint8Array(bits);
}

async function xorFallback(text, salt, tokenIndex, context) {
  const bytes = new TextEncoder().encode(text);
  const keystream = await deriveKeystream(salt, tokenIndex, bytes.length, context);
  return Array.from(bytes)
    .map((b, i) => (b ^ keystream[i]).toString(16).padStart(2, '0'))
    .join('');
}

async function xorUnfallback(hexVal, salt, tokenIndex, context) {
  const raw = new Uint8Array(hexVal.match(/.{2}/g).map(h => parseInt(h, 16)));
  const keystream = await deriveKeystream(salt, tokenIndex, raw.length, context);
  return new TextDecoder().decode(raw.map((b, i) => b ^ keystream[i]));
}

function caseFlag(word) {
  if (word === word.toUpperCase()) return '^U';
  if (word[0] === word[0].toUpperCase()) return '^C';
  return '';
}

function applyCase(word, flag) {
  if (flag === '^U') return word.toUpperCase();
  if (flag === '^C') return word[0].toUpperCase() + word.slice(1);
  return word;
}

function* tokenize(mensaje) {
  // Yields {type: 'word'|'digits'|'punct', value: string}
  // Consecutive digits are grouped into a single 'digits' run so they
  // become one fallback token instead of one hex token per character.
  let current = '';
  let currentType = null;
  for (const ch of mensaje) {
    let chType;
    if (/\d/u.test(ch)) chType = 'digits';
    else if (/\p{L}/u.test(ch)) chType = 'word';
    else chType = null;

    if (chType !== null) {
      if (currentType !== null && chType !== currentType) {
        yield { type: currentType, value: current };
        current = '';
      }
      currentType = chType;
      current += ch;
    } else {
      if (current) {
        yield { type: currentType, value: current };
        current = '';
        currentType = null;
      }
      yield { type: 'punct', value: ch };
    }
  }
  if (current) yield { type: currentType, value: current };
}

export async function cifrarMensaje(idTango, mensaje, baseTangos, salt) {
  const idStr = String(idTango);
  if (!baseTangos[idStr] || idStr.startsWith('_')) throw new Error('ID de tango no válido');

  const tango = baseTangos[idStr];
  const saltNum = parseInt(salt);
  const tokens = [];

  for (const { type, value } of tokenize(mensaje)) {
    if (type === 'punct') {
      tokens.push(`~${value.codePointAt(0).toString(16).padStart(2, '0')}`);
      continue;
    }

    if (type === 'digits') {
      // Digits never appear in tango lyrics; encrypt directly as fallback.
      const hexCifrado = await xorFallback(
        value,
        saltNum,
        tokens.length,
        `${idStr}:${tokens.join('-')}`
      );
      tokens.push(`#${hexCifrado}`);
      continue;
    }

    const flag = caseFlag(value);
    const palabraLower = value.toLowerCase();

    // Collect ALL matching coordinates, then pick one at random.
    // Breaks frequency analysis: same word no longer always → same VxxPyy.
    const getPalabras = verso => (Array.isArray(verso) ? verso : verso.palabras);
    const matches = [];

    tango.versos.forEach((verso, iV) => {
      getPalabras(verso).forEach((pTango, iP) => {
        if (pTango.toLowerCase() === palabraLower) {
          const vPad = String(iV + 1).padStart(2, '0');
          const pPad = String(iP + 1).padStart(2, '0');
          matches.push(`V${vPad}P${pPad}${flag}`);
        }
      });
    });

    if (matches.length > 0) {
      // crypto.getRandomValues for a secure random index
      const idx = crypto.getRandomValues(new Uint32Array(1))[0] % matches.length;
      tokens.push(matches[idx]);
    } else {
      const hexCifrado = await xorFallback(
        palabraLower,
        saltNum,
        tokens.length,
        `${idStr}:${tokens.join('-')}`
      );
      tokens.push(`#${hexCifrado}${flag}`);
    }
  }

  const claveEnmascarada = parseInt(idTango) + saltNum;
  return `${claveEnmascarada}-${tokens.join('-')}`;
}

/**
 * Descifra un mensaje producido por cifrarMensaje, restaurando texto exacto.
 *
 * Lanza Error para cualquier entrada malformada, truncada o fuera de rango,
 * en lugar de devolver NaN/undefined o basura silenciosa (mismo contrato
 * que descifrar_mensaje en cipher_engine.py).
 */
export async function descifrarMensaje(codigoCifrado, baseTangos, salt) {
  if (!codigoCifrado || !codigoCifrado.includes('-')) {
    throw new Error('Formato de mensaje cifrado inválido');
  }

  const partes = codigoCifrado.trim().split('-');

  const claveEnmascarada = Number(partes[0]);
  if (!Number.isInteger(claveEnmascarada)) {
    throw new Error(`Clave enmascarada no es un número: '${partes[0]}'`);
  }

  const saltNum = parseInt(salt);
  const idTango = String(claveEnmascarada - saltNum);

  if (!baseTangos[idTango] || idTango.startsWith('_')) {
    throw new Error('Clave enmascarada inválida o tango no existe');
  }

  const tango = baseTangos[idTango];
  const versos = tango.versos;
  const resultado = [];

  for (let i = 1; i < partes.length; i++) {
    let token = partes[i];
    const tokenIndex = i - 1; // position in token stream

    // Punctuation / space token
    if (token.startsWith('~')) {
      const code = parseInt(token.slice(1), 16);
      if (token.length < 2 || Number.isNaN(code)) {
        throw new Error(`Token de puntuación malformado: '${token}'`);
      }
      resultado.push(String.fromCodePoint(code));
      continue;
    }

    // Extract case flag
    let flag = '';
    if (token.endsWith('^U')) {
      flag = '^U';
      token = token.slice(0, -2);
    } else if (token.endsWith('^C')) {
      flag = '^C';
      token = token.slice(0, -2);
    }

    if (token.startsWith('#')) {
      const hex = token.slice(1);
      if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
        throw new Error(`Token fallback hex malformado: '#${hex}'`);
      }
      const palabra = await xorUnfallback(
        hex,
        saltNum,
        tokenIndex,
        `${idTango}:${partes.slice(1, i).join('-')}`
      );
      resultado.push(applyCase(palabra, flag));
    } else {
      const match = token.match(/^V(\d+)P(\d+)$/);
      if (!match) {
        throw new Error(`Token de coordenada malformado: '${token}'`);
      }
      const nV = parseInt(match[1]) - 1;
      const nP = parseInt(match[2]) - 1;
      if (nV < 0 || nV >= versos.length) {
        throw new Error(`Índice de verso fuera de rango: V${nV + 1} (total: ${versos.length})`);
      }
      const verso = versos[nV];
      const palabras = Array.isArray(verso) ? verso : verso.palabras;
      if (nP < 0 || nP >= palabras.length) {
        throw new Error(`Índice de palabra fuera de rango: P${nP + 1} (total: ${palabras.length})`);
      }
      const palabra = palabras[nP].toLowerCase();
      resultado.push(applyCase(palabra, flag));
    }
  }

  return resultado.join('');
}

