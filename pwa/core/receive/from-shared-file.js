/**
 * core/receive/from-shared-file.js
 *
 * Reads ciphertext from a .txt file the receiver opened via Telegram's
 * document attachment (strategy #2 — see core/transport/document.js).
 *
 * Two ways a File can reach this function:
 *   - Web Share Target: manifest.json registers a share_target, so when
 *     the receiver uses Telegram's native "Share" action on the file,
 *     the OS hands it to this app directly — no manual save/open step.
 *   - Manual fallback: a plain <input type="file"> in the UI, for
 *     browsers or flows where share_target isn't available (e.g. desktop
 *     testing, or before the manifest change ships).
 *
 * Either path ends up calling resolveFromSharedFile(file) with a real
 * File object — this function doesn't care which path produced it.
 *
 * Paired send-side strategy: core/transport/document.js
 *
 * @param {File|null|undefined} file
 * @returns {Promise<string|null>}
 */
export async function resolveFromSharedFile(file) {
  if (!file) return null;
  const text = await file.text();
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

