/**
 * core/transport/document.js
 *
 * Strategy #2 (Fase 10.1.1): send the ciphertext as a single .txt file
 * attachment via Telegram's sendDocument, instead of chunking it across
 * multiple text messages (chunked-text.js).
 *
 * Why this exists: chunked-text.js's deep-link button stops carrying the
 * ciphertext once the encoded URL exceeds Telegram's 2048-byte button-url
 * limit (roughly ~1200 ciphertext chars before encoding) — above that,
 * the receiver has to manually copy/reassemble N fragmented messages,
 * which nothing in the app actually supports end-to-end. sendDocument
 * sidesteps the problem instead of working around it:
 *   - No chunking: one message, one attachment, regardless of length.
 *   - No button-URL limit: the button doesn't need to carry the
 *     ciphertext at all — it just opens the app.
 *   - Telegram's document limit is 50MB — no practical ceiling for text.
 *
 * Receiving side: the button opens the app, and the receiver taps the
 * attached .txt file in Telegram. The app reads its contents via the
 * File API — either through Web Share Target (manifest.json's
 * share_target, so Telegram's native "Share" action hands the file
 * straight to the app) or a manual <input type="file"> fallback.
 *
 * Paired receive-side resolver: core/receive/from-shared-file.js
 *
 * DOM dependency: uses Blob/FormData, both available in the PWA's browser
 * runtime and in Node ≥18 for testing without extra polyfills.
 */

async function describeError(resp) {
  try {
    const data = await resp.json();
    return data.description ? ` (${data.description})` : '';
  } catch {
    return '';
  }
}

/** @type {import("./types.js").Transport} */
export const documentTransport = {
  async send(ciphertext, ctx) {
    const { botToken, chatId, origin, pathname, fetchFn = fetch } = ctx;
    const apiUrl = `https://api.telegram.org/bot${botToken}/sendDocument`;
    const appUrl = `${origin}${pathname}`;

    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('document', new Blob([ciphertext], { type: 'text/plain' }), 'mensaje.txt');
    // No ?c= param here on purpose — see module docblock. The receiver
    // gets the ciphertext from the attached file, not the button URL.
    form.append(
      'reply_markup',
      JSON.stringify({
        inline_keyboard: [[{ text: 'Descifrar →', url: appUrl }]],
      })
    );

    let resp;
    try {
      resp = await fetchFn(apiUrl, { method: 'POST', body: form });
    } catch (cause) {
      // Network-level failure (no response at all — offline, DNS,
      // timeout before headers). document transport sends in a single
      // HTTP call — chunksSentBeforeFail is always 0 but we keep the
      // same structured error shape as chunked-text.js so the UI's
      // catch handler can display a unified toast.
      const err = new Error(
        'Error de red al enviar el documento a Telegram (no se recibió respuesta del servidor).'
      );
      err.name = 'TelegramNetworkError';
      err.cause = cause;
      err.httpStatus = null;
      err.chunksSentBeforeFail = 0;
      err.chunksTotal = 1;
      err.partIndex = 1;
      err.isPartialSend = false;
      throw err;
    }

    if (!resp.ok) {
      const detalle = await describeError(resp);
      const err = new Error(`Error al enviar el documento a Telegram${detalle}.`);
      err.name = 'TelegramApiError';
      err.httpStatus = resp.status;
      err.chunksSentBeforeFail = 0;
      err.chunksTotal = 1;
      err.partIndex = 1;
      err.isPartialSend = false;
      throw err;
    }

    // deepLinkCapable is true here even though this strategy carries no
    // ?c= — the receiver still reaches plaintext without manual
    // copy/paste, just via a file tap instead of a pre-loaded URL.
    return { deepLinkCapable: true, partsSent: 1 };
  },
};

