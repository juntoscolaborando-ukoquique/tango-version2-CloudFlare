/**
 * core/transport/server-bridge.js
 *
 * Strategy #3 (NOT IMPLEMENTED). Would route the ciphertext through a
 * small server you control instead of Telegram, so the receiver's app
 * could be woken via FCM/APNs push without opening any messenger app.
 *
 * This file exists only to reserve the shape so core/transport/index.js
 * doesn't need structural changes when this strategy is eventually built
 * — only its selectTransport() branch and this file's body.
 *
 * Deliberately throws until implemented, so accidental use fails loudly
 * instead of silently doing nothing.
 *
 * Paired receive-side resolver: core/receive/from-server-push.js
 */

/** @type {import("./types.js").Transport} */
export const serverBridgeTransport = {
  async send(_ciphertext, _ctx) {
    throw new Error(
      'server-bridge transport is not implemented. ' +
        "See ROADMAP.md 'Fase 11' (or wherever this gets scheduled) for the design discussion."
    );
  },
};

