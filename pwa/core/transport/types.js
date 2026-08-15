/**
 * core/transport/types.js
 *
 * Shared contracts for all send-side strategies. No logic lives here —
 * only the shape every transport must implement and the Telegram-imposed
 * constants that more than one transport needs to agree on.
 *
 * Adding a new transport means: implement this shape in a new file, wire
 * it into core/transport/index.js's selectTransport(). Nothing else in
 * the codebase should ever import a specific transport module directly —
 * always go through core/transport/index.js's sendCiphertext().
 */

/**
 * @typedef {object} SendContext
 * @property {string} botToken
 * @property {string} chatId
 * @property {string} origin    - e.g. "https://user.github.io" (for building app URLs)
 * @property {string} pathname  - e.g. "/repo/pwa/index.html"
 * @property {string} search    - current location.search, merged into any URL this transport builds
 * @property {typeof fetch} [fetchFn] - injectable for testing; defaults to global fetch
 */

/**
 * @typedef {object} SendResult
 * @property {boolean} deepLinkCapable - true if the receiver can reach plaintext
 *   in one tap with no manual copy/paste, however this transport achieves that.
 * @property {number} partsSent - number of Telegram API calls this send made
 *   (chunks for chunked-text, always 1 for document).
 */

/**
 * @typedef {object} Transport
 * @property {(ciphertext: string, ctx: SendContext) => Promise<SendResult>} send
 */

// Telegram Bot API limits — shared across transports that need to reason
// about them. Do not duplicate these numbers in individual transport files.
export const TELEGRAM_TEXT_MAX = 4096; // sendMessage text limit (chars)
export const TELEGRAM_BUTTON_URL_MAX = 2048; // inline_keyboard button url limit (bytes)
export const TELEGRAM_DOCUMENT_MAX = 50 * 1024 * 1024; // sendDocument limit (bytes) — for reference only, not enforced client-side

