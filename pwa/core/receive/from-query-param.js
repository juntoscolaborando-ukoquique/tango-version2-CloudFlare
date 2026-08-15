/**
 * core/receive/from-query-param.js
 *
 * Reads and clears the ?c= ciphertext left by the chunked-text transport's
 * deep link button. Paired send-side strategy:
 * core/transport/chunked-text.js (that module writes the ?c= this one
 * reads — if the wire format changes there, update it here too).
 *
 * DOM-free — location/history are injectable for testing, matching the
 * rest of core/.
 *
 * (This is a straight move of the pre-existing consumeDeepLink() from
 * pwa/deeplink.js — same behavior, renamed to fit the resolver naming
 * convention used across core/receive/.)
 *
 * @param {Location} [loc] - defaults to window.location
 * @param {History} [hist] - defaults to window.history
 * @returns {string|null} decoded ciphertext, or null if no ?c= is present
 */
export function resolveFromQueryParam(loc = location, hist = history) {
  const params = new URLSearchParams(loc.search);
  const encoded = params.get('c');
  if (!encoded) return null;

  // Remove ?c= from the URL immediately — before any async work — so
  // it's gone even if vault unlock takes a few seconds.
  params.delete('c');
  const newSearch = params.toString() ? '?' + params.toString() : '';
  hist.replaceState(null, '', loc.pathname + newSearch + loc.hash);

  try {
    return decodeURIComponent(encoded);
  } catch {
    // Malformed percent-encoding — treat as no deep link rather than crash.
    return null;
  }
}

