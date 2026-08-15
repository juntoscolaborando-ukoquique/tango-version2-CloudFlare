/**
 * core/transport/index.js
 *
 * The ONLY module allowed to know that more than one transport strategy
 * exists. app.js (and any future UI) calls sendCiphertext() and receives
 * a plain SendResult back — it never learns which strategy ran, and
 * never imports chunked-text.js, document.js, or server-bridge.js
 * directly.
 *
 * Adding a strategy: implement core/transport/types.js's Transport shape
 * in a new file, add one branch here. Do not touch chunked-text.js or
 * document.js to add a third option — that coupling is exactly what this
 * module exists to prevent.
 */

import { chunkedTextTransport, buildDeepLink } from './chunked-text.js';
import { documentTransport } from './document.js';
import { TELEGRAM_BUTTON_URL_MAX } from './types.js';

/**
 * Decision rule (ROADMAP.md Fase 10.1.1): use chunked-text when its deep
 * link fits Telegram's button-URL limit — that's the case where it sends
 * in one message with a working pre-loaded button, i.e. exactly as good
 * as document.js but without a file attachment. Once the ciphertext is
 * long enough to either need multiple chunks OR blow the button-URL
 * limit on its own, document.js is strictly better (one message, no
 * manual reassembly), so it wins.
 *
 * @param {string} ciphertext
 * @param {import("./types.js").SendContext} ctx
 * @returns {import("./types.js").Transport}
 */
export function selectTransport(ciphertext, ctx) {
  const deepLink = buildDeepLink(ctx.origin, ctx.pathname, ctx.search, ciphertext);
  return deepLink.length <= TELEGRAM_BUTTON_URL_MAX ? chunkedTextTransport : documentTransport;
}

/**
 * Single entry point the UI should call to send a ciphertext. Hides both
 * which transport was picked and how many network calls it took.
 *
 * @param {string} ciphertext
 * @param {import("./types.js").SendContext} ctx
 * @returns {Promise<import("./types.js").SendResult>}
 */
export async function sendCiphertext(ciphertext, ctx) {
  const transport = selectTransport(ciphertext, ctx);
  return transport.send(ciphertext, ctx);
}

