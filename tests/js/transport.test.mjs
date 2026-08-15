/**
 * transport.test.mjs
 *
 * Tests for the Fase 10.1.1 transport layer:
 *   core/transport/  — chunkCipherText, buildDeepLink, selectTransport,
 *                      chunkedTextTransport.send, documentTransport.send
 *   core/receive/   — resolveFromQueryParam, resolveIncoming
 *
 * All network calls are intercepted via ctx.fetchFn so tests run offline.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  chunkCipherText,
  buildDeepLink,
  chunkedTextTransport,
} from '../../pwa/core/transport/chunked-text.js';
import { documentTransport } from '../../pwa/core/transport/document.js';
import { selectTransport, sendCiphertext } from '../../pwa/core/transport/index.js';
import { TELEGRAM_TEXT_MAX, TELEGRAM_BUTTON_URL_MAX } from '../../pwa/core/transport/types.js';
import { resolveFromQueryParam } from '../../pwa/core/receive/from-query-param.js';
import { resolveIncoming } from '../../pwa/core/receive/index.js';

// ---------- helpers ----------

function makeCtx(overrides = {}) {
  return {
    botToken: 'TOKEN',
    chatId: '123',
    origin: 'https://example.github.io',
    pathname: '/pwa/index.html',
    search: '',
    fetchFn: async () => ({ ok: true, json: async () => ({}) }),
    ...overrides,
  };
}

function makeLocation({ search = '', hash = '', pathname = '/pwa/index.html' } = {}) {
  return { search, hash, pathname, origin: 'https://example.github.io' };
}

function makeHistory() {
  const calls = [];
  return {
    calls,
    replaceState(s, t, url) {
      calls.push(url);
    },
  };
}

// ---------- chunkCipherText ----------

test('chunkCipherText: short message returns single element, no prefix', () => {
  const cipher = '50-V01P02-~20-V01P03';
  const result = chunkCipherText(cipher, TELEGRAM_TEXT_MAX);
  assert.equal(result.length, 1);
  assert.equal(result[0], cipher);
});

test('chunkCipherText: message exactly at limit stays one chunk', () => {
  assert.equal(chunkCipherText('A'.repeat(TELEGRAM_TEXT_MAX), TELEGRAM_TEXT_MAX).length, 1);
});

test('chunkCipherText: splits on token boundary', () => {
  const t1 = 'A'.repeat(92),
    t2 = 'X';
  const result = chunkCipherText(`${t1}-${t2}`, 90);
  assert.equal(result.length, 2);
  assert.ok(result[0].startsWith('[1/2] '));
  assert.ok(result[1].startsWith('[2/2] '));
});

test('chunkCipherText: all chunks within maxLen', () => {
  const cipher = Array.from(
    { length: 200 },
    (_, i) => `V${String(i + 1).padStart(2, '0')}P${String(i + 1).padStart(2, '0')}`
  ).join('-');
  for (const chunk of chunkCipherText(cipher, 200)) {
    assert.ok(chunk.length <= 200);
  }
});

test('chunkCipherText: reassembles to original', () => {
  const cipher = Array.from(
    { length: 100 },
    (_, i) => `V${String(i + 1).padStart(2, '0')}P${String(i + 1).padStart(2, '0')}`
  ).join('-');
  const stripped = chunkCipherText(cipher, 100).map(c => c.replace(/^\[\d+\/\d+\] /, ''));
  assert.equal(stripped.join('-'), cipher);
});

// ---------- C-1 TokenOverflowError tests ----------

test('chunkCipherText: single oversized token byte-splits correctly', () => {
  // Create a single token that exceeds effectiveMax (4088 for maxLen=4096) but has room for prefix
  const oversizedToken = '#' + 'A'.repeat(4200); // 4201 chars total
  const maxLen = 4096;
  const effectiveMax = maxLen - 8; // 4088

  assert.ok(oversizedToken.length > effectiveMax, 'token must be oversized for test');

  const result = chunkCipherText(oversizedToken, maxLen);
  assert.ok(result.length >= 2, 'oversized token should split into multiple chunks');

  // Verify all chunks respect maxLen limit
  for (const chunk of result) {
    assert.ok(chunk.length <= maxLen, `chunk "${chunk.slice(0, 50)}..." exceeds maxLen`);
  }

  // Verify chunks have proper [i/N] prefixes
  assert.ok(result[0].match(/^\[1\/\d+\]/), 'first chunk has [1/N] prefix');
  assert.ok(result[result.length - 1].match(/^\[\d+\/\d+\]/), 'last chunk has [i/N] prefix');

  // Verify byte-split reconstruction preserves original token
  const stripped = result.map(c => c.replace(/^\[\d+\/\d+\] /, '')).join('');
  assert.equal(stripped, oversizedToken, 'byte-split chunks should reconstruct original token');
});

test('chunkCipherText: extremely oversized token throws TokenOverflowError', () => {
  // Create a token so large that even with minimum prefix it exceeds maxLen
  const hugeToken = '#' + 'A'.repeat(5000); // Way bigger than any reasonable limit
  const tinyMaxLen = 20; // Small limit to force the fit < 16 condition

  assert.throws(
    () => chunkCipherText(hugeToken, tinyMaxLen),
    {
      name: 'TokenOverflowError',
      message: /Token de longitud \d+ excede el presupuesto/,
    },
    'should throw TokenOverflowError for impossibly large tokens'
  );

  try {
    chunkCipherText(hugeToken, tinyMaxLen);
    assert.fail('should have thrown TokenOverflowError');
  } catch (err) {
    assert.equal(err.name, 'TokenOverflowError');
    assert.equal(typeof err.tokenLength, 'number');
    assert.equal(typeof err.maxLen, 'number');
    assert.equal(typeof err.budget, 'number');
    assert.equal(typeof err.chunkIndex, 'number');
    assert.ok(err.tokenLength > err.maxLen, 'tokenLength should exceed maxLen');
    assert.ok(
      err.message.includes('números extremadamente largos'),
      'should suggest fixing digit runs'
    );
  }
});

test('chunkCipherText: multi-stage byte-splitting for very long tokens', () => {
  // Test that a token requiring multiple splits eventually succeeds
  const veryLongToken = '#' + 'B'.repeat(12000); // Requires multiple 4KB splits
  const result = chunkCipherText(veryLongToken, 4096);

  assert.ok(result.length >= 3, 'very long token should require multiple splits');

  // All chunks should be within limit
  for (const chunk of result) {
    assert.ok(chunk.length <= 4096, 'each chunk must be within maxLen');
  }

  // Reconstruction should match original
  const reconstructed = result.map(c => c.replace(/^\[\d+\/\d+\] /, '')).join('');
  assert.equal(reconstructed, veryLongToken, 'multi-stage split should preserve original');
});

// ---------- buildDeepLink ----------

test('buildDeepLink: uses ?c= query param (not fragment)', () => {
  const url = buildDeepLink('https://x.io', '/pwa/index.html', '', '50-V01P02');
  assert.ok(url.includes('?c='));
  assert.ok(!url.includes('#c='));
});

test('buildDeepLink: merges into existing search', () => {
  const url = buildDeepLink('https://x.io', '/pwa/index.html', '?src=twa-apk', '50-V01P02');
  const p = new URL(url).searchParams;
  assert.equal(p.get('src'), 'twa-apk');
  assert.equal(p.get('c'), '50-V01P02');
});

// ---------- selectTransport ----------

test('selectTransport: returns chunkedText for short ciphertext', () => {
  const cipher = '50-V01P02-~20-V01P03'; // short — URL well under 2048
  const transport = selectTransport(cipher, makeCtx());
  assert.equal(transport, chunkedTextTransport);
});

test('selectTransport: returns document for long ciphertext (URL > 2048)', () => {
  // Build a ciphertext whose encoded URL would exceed 2048 bytes
  const longCipher = Array.from({ length: 300 }, (_, i) => `#${String(i).padStart(8, '0')}`).join(
    '-'
  );
  const transport = selectTransport(longCipher, makeCtx());
  assert.equal(transport, documentTransport);
});

// ---------- chunkedTextTransport.send ----------

test('chunkedTextTransport: sends one message for short ciphertext', async () => {
  const calls = [];
  const ctx = makeCtx({
    fetchFn: async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) });
      return { ok: true, json: async () => ({}) };
    },
  });
  const result = await chunkedTextTransport.send('50-V01P02', ctx);
  assert.equal(calls.length, 1);
  assert.equal(result.partsSent, 1);
  assert.ok(result.deepLinkCapable);
  assert.ok(calls[0].body.reply_markup, 'last chunk has button');
  assert.ok(calls[0].body.reply_markup.inline_keyboard[0][0].url.includes('?c='));
});

test('chunkedTextTransport: button opens app root when URL too long', async () => {
  const calls = [];
  const ctx = makeCtx({
    fetchFn: async (url, opts) => {
      calls.push(JSON.parse(opts.body));
      return { ok: true, json: async () => ({}) };
    },
  });
  const longCipher = 'V01P01-'.repeat(500).slice(0, -1);
  await chunkedTextTransport.send(longCipher, ctx);
  const last = calls[calls.length - 1];
  assert.ok(last.reply_markup, 'last chunk has button');
  assert.ok(
    !last.reply_markup.inline_keyboard[0][0].url.includes('?c='),
    'no ?c= for long message'
  );
});

test('chunkedTextTransport: throws on Telegram error', async () => {
  const ctx = makeCtx({
    fetchFn: async () => ({
      ok: false,
      json: async () => ({ description: 'Bad Request' }),
    }),
  });
  await assert.rejects(() => chunkedTextTransport.send('50-V01P02', ctx), /Bad Request/);
});

// ---------- documentTransport.send ----------

test('documentTransport: sends one FormData request', async () => {
  const calls = [];
  const ctx = makeCtx({
    fetchFn: async (url, opts) => {
      calls.push({ url, body: opts.body });
      return { ok: true, json: async () => ({}) };
    },
  });
  const result = await documentTransport.send('50-V01P02', ctx);
  assert.equal(calls.length, 1);
  assert.equal(result.partsSent, 1);
  assert.ok(result.deepLinkCapable);
  assert.ok(calls[0].url.includes('sendDocument'));
  assert.ok(calls[0].body instanceof FormData);
});

test('documentTransport: button URL does NOT contain ?c=', async () => {
  let sentReplyMarkup = null;
  const ctx = makeCtx({
    fetchFn: async (url, opts) => {
      const form = opts.body;
      if (form instanceof FormData) {
        sentReplyMarkup = JSON.parse(form.get('reply_markup'));
      }
      return { ok: true, json: async () => ({}) };
    },
  });
  await documentTransport.send('50-V01P02-very-long', ctx);
  assert.ok(sentReplyMarkup, 'reply_markup sent');
  const btnUrl = sentReplyMarkup.inline_keyboard[0][0].url;
  assert.ok(!btnUrl.includes('?c='), 'document transport button carries no ciphertext');
});

test('documentTransport: throws on Telegram error', async () => {
  const ctx = makeCtx({
    fetchFn: async () => ({
      ok: false,
      json: async () => ({ description: 'File too large' }),
    }),
  });
  await assert.rejects(() => documentTransport.send('50-V01P02', ctx), /File too large/);
});

// ---------- resolveFromQueryParam ----------

test('resolveFromQueryParam: returns null when no ?c=', () => {
  assert.equal(resolveFromQueryParam(makeLocation(), makeHistory()), null);
});

test('resolveFromQueryParam: decodes ciphertext from ?c=', () => {
  const cipher = '50-V01P02-~20-V01P03';
  const loc = makeLocation({ search: '?c=' + encodeURIComponent(cipher) });
  assert.equal(resolveFromQueryParam(loc, makeHistory()), cipher);
});

test('resolveFromQueryParam: clears ?c= via replaceState, keeps other params', () => {
  const cipher = '50-V01P02';
  const loc = makeLocation({ search: '?src=twa-apk&c=' + encodeURIComponent(cipher) });
  const hist = makeHistory();
  resolveFromQueryParam(loc, hist);
  assert.ok(hist.calls[0].includes('src=twa-apk'));
  assert.ok(!hist.calls[0].includes('&c='));
});

test('resolveFromQueryParam: returns null for malformed encoding', () => {
  assert.equal(resolveFromQueryParam(makeLocation({ search: '?c=%ZZ' }), makeHistory()), null);
});

// ---------- resolveIncoming ----------

test('resolveIncoming: reads ?c= when present', async () => {
  const cipher = '50-V01P02';
  const loc = makeLocation({ search: '?c=' + encodeURIComponent(cipher) });
  const result = await resolveIncoming({ loc, hist: makeHistory() });
  assert.equal(result, cipher);
});

test('resolveIncoming: returns null when nothing present', async () => {
  const result = await resolveIncoming({ loc: makeLocation(), hist: makeHistory() });
  assert.equal(result, null);
});

test('resolveIncoming: reads from sharedFile when no ?c=', async () => {
  // Simulate a File object with .text() method
  const cipher = '50-V01P02-~20-V01P03';
  const fakeFile = { text: async () => cipher };
  const result = await resolveIncoming({
    loc: makeLocation(),
    hist: makeHistory(),
    sharedFile: fakeFile,
  });
  assert.equal(result, cipher);
});

test('resolveIncoming: ?c= takes priority over sharedFile', async () => {
  const fromUrl = 'from-url';
  const fromFile = 'from-file';
  const loc = makeLocation({ search: '?c=' + encodeURIComponent(fromUrl) });
  const fakeFile = { text: async () => fromFile };
  const result = await resolveIncoming({ loc, hist: makeHistory(), sharedFile: fakeFile });
  assert.equal(result, fromUrl);
});

// ---------- selectTransport invariant: deepLinkCapable always true ----------

test('invariant: every transport always returns deepLinkCapable=true', async () => {
  // Both strategies must honour the invariant that the receiver can reach
  // plaintext without manual copy/paste. If a new transport breaks this,
  // the console.warn in handleSend() will fire in production.
  const shortCipher = '50-V01P02';
  const longCipher = Array.from({ length: 300 }, (_, i) => `#${String(i).padStart(8, '0')}`).join(
    '-'
  );
  const ctx = makeCtx({
    fetchFn: async (url, opts) => ({
      ok: true,
      json: async () => ({}),
    }),
  });

  const short = await sendCiphertext(shortCipher, ctx);
  assert.ok(short.deepLinkCapable, 'chunkedTextTransport must set deepLinkCapable=true');

  // documentTransport also needs a fetchFn that accepts FormData
  const longResult = await sendCiphertext(longCipher, ctx);
  assert.ok(longResult.deepLinkCapable, 'documentTransport must set deepLinkCapable=true');
});

