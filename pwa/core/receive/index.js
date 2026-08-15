/**
 * core/receive/index.js
 *
 * The ONLY module allowed to know that more than one receive path exists.
 * app.js calls resolveIncoming() and receives either a plain ciphertext
 * string or null — it never learns which resolver ran.
 *
 * Current paths (in priority order):
 *   1. ?c= query param — written by chunked-text.js's deep-link button.
 *   2. Shared/opened file — a .txt written by document.js's attachment.
 *      Reached via Web Share Target or manual <input type="file">.
 *
 * Adding a resolver: implement the shape from from-query-param.js in a
 * new file, add one branch here. Do not touch from-query-param.js or
 * from-shared-file.js to add a third option.
 *
 * @typedef {object} ResolveOptions
 * @property {Location} [loc]        - defaults to window.location (?c= path)
 * @property {History}  [hist]       - defaults to window.history  (?c= path)
 * @property {File|null} [sharedFile] - a File from <input type="file"> or
 *                                      Web Share Target (document path)
 */

import { resolveFromQueryParam } from './from-query-param.js';
import { resolveFromSharedFile } from './from-shared-file.js';

/**
 * Try every known receive path in priority order. Returns the first
 * non-null ciphertext found, or null if nothing arrived.
 *
 * @param {ResolveOptions} [opts]
 * @returns {Promise<string|null>}
 */
export async function resolveIncoming(opts = {}) {
  const { loc = location, hist = history, sharedFile = null } = opts;

  // 1. ?c= query param — synchronous, no I/O.
  const fromParam = resolveFromQueryParam(loc, hist);
  if (fromParam) return fromParam;

  // 2. Shared/opened file — async file read.
  const fromFile = await resolveFromSharedFile(sharedFile);
  if (fromFile) return fromFile;

  return null;
}

