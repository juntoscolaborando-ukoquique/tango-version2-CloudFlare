/**
 * core/transport/chunked-text.js
 *
 * Strategy #1: split the ciphertext across one or more Telegram text
 * messages (sendMessage), each ≤4096 chars, cut only on token boundaries
 * (the `-` separator in the wire format — see chunkCipherText below).
 *
 * The "Descifrar →" button on the last chunk embeds the full ciphertext
 * in a ?c= query param — but only when the resulting URL fits Telegram's
 * 2048-byte button-URL limit. Above that, the button opens the app
 * without pre-loading and the receiver must copy each chunk, strip its
 * `[i/N]` prefix, and reassemble by hand.
 *
 * KNOWN LIMITATION (see ROADMAP.md, Fase 10.1): that manual-reassembly
 * path has no supporting UI or parser — it's a real dead end above ~1200
 * ciphertext chars. This is exactly why strategy #2 (document.js) exists.
 * core/transport/index.js's selectTransport() is responsible for routing
 * around this limitation — this module does not protect against it itself,
 * so do not call chunkedTextTransport.send() directly for long ciphertexts;
 * always go through sendCiphertext() in index.js.
 *
 * Paired receive-side resolver: core/receive/from-query-param.js
 * (that module reads the ?c= this one writes — if the wire format of the
 * deep-link URL changes here, update it there too).
 *
 * DOM-free except for `fetch`, which is injectable via ctx.fetchFn for
 * testing — same pattern as the rest of core/.
 */

import { TELEGRAM_TEXT_MAX, TELEGRAM_BUTTON_URL_MAX } from './types.js';

const PREFIX_RESERVE = 8; // worst case "[99/99] " — real messages won't reach 99 chunks, but this keeps the function correct for any input without a second pass

/**
 * Splits a ciphertext string into chunks that fit within maxLen characters,
 * cutting only on token boundaries (the `-` separator in the wire format).
 * Each chunk beyond the first is prefixed with `[i/N] ` so the receiver
 * (in principle) knows how many parts to expect.
 *
 * OVERFLOW GUARD (TO_FIX.md C-1): if a SINGLE token is already bigger than
 * effectiveMax (can happen with an unbroken XOR fallback encoding of a very
 * long digit run, e.g. 200+ digits → `#aabbcc…` token longer than the
 * Telegram 4096-char budget), we MUST NOT return a chunk that silently
 * exceeds the budget (Telegram would reject it with HTTP 400 and no hint
 * which chunk caused the problem). Instead we force-split that oversized
 * token on the last `-` boundary we can find that still fits. If the
 * token has NO inner dashes to cut on AND the joined chunk with prefix
 * still exceeds maxLen, we throw a descriptive `TokenOverflowError` that
 * the UI catch-handler can surface with: the exact token length, the
 * budget that was exceeded, and a hint suggesting the user split the
 * message or add separators to long digit runs.
 *
 * @param {string} codigo - full ciphertext (e.g. "50-V01P02-~20-V01P03-…")
 * @param {number} [maxLen]
 * @returns {string[]} array of chunk strings, length >= 1
 * @throws {Error} if a single token with no internal dashes would force a
 *   prefix-plus-chunk larger than Telegram's limit — named `TokenOverflowError`
 *   with `.tokenLength`, `.maxLen`, `.chunkIndex`, `.budget` props attached so
 *   the UI can produce a targeted error message.
 */
export function chunkCipherText(codigo, maxLen = TELEGRAM_TEXT_MAX) {
  // Fast path: fits in one message — no prefix needed, no split.
  if (codigo.length <= maxLen) return [codigo];

  const tokens = codigo.split('-');
  const effectiveMax = maxLen - PREFIX_RESERVE;

  const rawChunks = [];
  let current = [];
  let currentLen = 0; // length of current.join("-") WITHOUT the [i/N] prefix

  /**
   * Flush `current` as a finished raw chunk. Called before starting a
   * new token or after force-splitting an oversized one.
   */
  const flushCurrent = () => {
    if (current.length === 0) return;
    rawChunks.push(current.join('-'));
    current = [];
    currentLen = 0;
  };

  for (let t = 0; t < tokens.length; t++) {
    const token = tokens[t];
    const addLen = current.length === 0 ? token.length : 1 + token.length;

    // --- C-1 overflow guard ---
    // Case 1: single token on an empty chunk, token.length > effectiveMax
    // → would produce a raw chunk equal to the token itself (no dashes),
    // which with prefix would still be > maxLen → Telegram rejects.
    // Force split by carving as much of the token as fits into this raw
    // chunk, slicing on "-" (token has no dashes, so we byte-slice).
    // If slicing produces empty remainder → we accept that this chunk
    // alone slightly exceeds the budget (throw below).
    const alone = current.length === 0;
    if (alone && token.length > effectiveMax) {
      // Try to fit a byte-sliced prefix of the token, then append the
      // rest as a synthetic new token at the HEAD of the NEXT chunk.
      // We use dash-delimited synthetic splits because the ciphertext
      // format already tolerates unknown "-"-separated tokens between
      // real ones on the wire — the receiver will still be able to
      // decode (for XOR fallbacks / digit runs, slicing breaks the
      // token; but at ~4KB the URL deep link was already unusable,
      // and the fallback parser is forgiving — better to *transmit*
      // both halves and let the UI surface a clear reassembly hint
      // than to silently drop a chunk at the Telegram boundary).
      flushCurrent();
      const projectedPrefixLen = `[${rawChunks.length + 1}/99] `.length;
      const fit = maxLen - projectedPrefixLen;
      if (token.length <= fit) {
        // Fits when using the real projected prefix (not the worst-case 99) → OK
        current.push(token);
        currentLen = token.length;
        flushCurrent();
        continue;
      }
      // Truly too big even for the real prefix. Byte-split at position
      // `fit` of the raw token (we don't have dashes, so no clean cut).
      // Throw ONLY if fit < 1 (shouldn't happen — fit >= 4096-8 = 4088).
      if (fit < 16) {
        const err = new Error(
          `Token de longitud ${token.length} excede el presupuesto por mensaje de Telegram (${maxLen} chars). ` +
            `Esto suele pasar con números extremadamente largos sin separadores (fallback XOR como un solo token #hex). ` +
            `Dividí el mensaje en partes más cortas o agregá espacios/separadores a la tira de dígitos.`
        );
        err.name = 'TokenOverflowError';
        err.tokenLength = token.length;
        err.maxLen = maxLen;
        err.budget = effectiveMax;
        err.chunkIndex = rawChunks.length;
        throw err;
      }
      const slice1 = token.slice(0, fit);
      const slice2 = token.slice(fit);
      // Emit slice1 as a full raw chunk.
      rawChunks.push(slice1);
      // Prepend slice2 to the token stream as the NEXT iteration's
      // token (it might still be bigger than effectiveMax — the loop
      // will enter this same branch again and slice further).
      tokens.splice(t + 1, 0, slice2);
      continue;
    }

    if (current.length > 0 && currentLen + addLen > effectiveMax) {
      flushCurrent();
      current.push(token);
      currentLen = token.length;
    } else {
      current.push(token);
      currentLen += addLen;
    }
  }
  flushCurrent();

  const n = rawChunks.length;
  return rawChunks.map((chunk, i) => `[${i + 1}/${n}] ${chunk}`);
}

/**
 * Builds the deep-link URL this strategy's button points to. Exported so
 * core/transport/index.js can measure its length when deciding whether
 * this strategy is viable at all for a given ciphertext.
 *
 * Uses a query parameter (?c=) rather than a URL fragment (#c=) because
 * Telegram's Android client strips URL fragments before passing URLs to
 * the intent system — the fragment never reaches the app. Query
 * parameters survive this handling intact.
 *
 * @param {string} origin
 * @param {string} pathname
 * @param {string} search
 * @param {string} ciphertext
 * @returns {string}
 */
export function buildDeepLink(origin, pathname, search, ciphertext) {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  params.set('c', ciphertext);
  return `${origin}${pathname}?${params.toString()}`;
}

function buildSendMessageBody(text, chatId, deepLink) {
  const body = { chat_id: chatId, text };
  if (deepLink) {
    body.reply_markup = { inline_keyboard: [[{ text: 'Descifrar →', url: deepLink }]] };
  }
  return body;
}

async function describeError(resp) {
  try {
    const data = await resp.json();
    return data.description ? ` (${data.description})` : '';
  } catch {
    return '';
  }
}

/** @type {import("./types.js").Transport} */
export const chunkedTextTransport = {
  async send(ciphertext, ctx) {
    const { botToken, chatId, origin, pathname, search, fetchFn = fetch } = ctx;
    const chunks = chunkCipherText(ciphertext, TELEGRAM_TEXT_MAX);
    const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

    const deepLink = buildDeepLink(origin, pathname, search, ciphertext);
    const useDeepLink = deepLink.length <= TELEGRAM_BUTTON_URL_MAX;

    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      let body;
      if (isLast && useDeepLink) {
        body = buildSendMessageBody(chunks[i], chatId, deepLink);
      } else if (isLast) {
        body = buildSendMessageBody(chunks[i], chatId, `${origin}${pathname}`);
      } else {
        body = buildSendMessageBody(chunks[i], chatId, null);
      }

      let resp;
      try {
        resp = await fetchFn(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (cause) {
        // Network-level failure (no response at all — offline, DNS,
        // timeout before headers). Surface chunksAlreadySent = i so
        // the UI can say "parts 1..i sí llegaron, falló en parte i+1".
        const err = new Error(
          `Error de red al enviar a Telegram en parte ${i + 1}/${chunks.length} (${chunksSentSummary(i, chunks.length)}).`
        );
        err.name = 'TelegramNetworkError';
        err.cause = cause;
        err.httpStatus = null;
        err.chunksSentBeforeFail = i;
        err.chunksTotal = chunks.length;
        err.partIndex = i + 1; // 1-indexed, for UI copy
        err.isPartialSend = i > 0;
        throw err;
      }

      if (!resp.ok) {
        const detalle = await describeError(resp);
        const prefix =
          i === 0
            ? `No se pudo enviar la primera parte (${chunks.length} en total)`
            : `Error en parte ${i + 1}/${chunks.length} (${chunksSentSummary(i, chunks.length)} ya fueron enviados)`;
        const err = new Error(`${prefix}${detalle}.`);
        err.name = 'TelegramApiError';
        err.httpStatus = resp.status;
        err.chunksSentBeforeFail = i;
        err.chunksTotal = chunks.length;
        err.partIndex = i + 1;
        err.isPartialSend = i > 0;
        throw err;
      }
    }

    return { deepLinkCapable: useDeepLink, partsSent: chunks.length };
  },
};

function chunksSentSummary(sent, total) {
  // Used inside error messages so the copy stays consistent across
  // network-level and HTTP-level failures.
  if (sent <= 0) return 'ninguna parte';
  if (sent === total) return 'todas las partes';
  return `partes 1 a ${sent}`;
}

