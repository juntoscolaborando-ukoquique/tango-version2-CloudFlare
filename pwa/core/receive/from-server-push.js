/**
 * core/receive/from-server-push.js
 *
 * Strategy #3 receive-side counterpart (NOT IMPLEMENTED). Would read a
 * ciphertext delivered via an FCM/APNs push payload instead of a
 * Telegram deep link or shared file.
 *
 * Paired send-side strategy: core/transport/server-bridge.js
 *
 * Deliberately throws until implemented, so accidental use fails loudly.
 */

/**
 * @param {unknown} _pushPayload
 * @returns {string|null}
 */
export function resolveFromServerPush(_pushPayload) {
  throw new Error('server-push resolver is not implemented.');
}

