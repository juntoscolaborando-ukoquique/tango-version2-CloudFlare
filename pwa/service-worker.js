/**
 * service-worker.js
 *
 * Two caching strategies, deliberately different:
 *
 *  - APP SHELL (html/js/fonts/icons/manifest): cache-first. This code only
 *    changes when you redeploy the PWA, so once it's cached there's no
 *    reason to hit the network for it — instant load, works offline.
 *    Matches by FULL resolved path (not endsWith) so a file in
 *    /pwa/sub/manifest.json doesn't accidentally hit the cache rule.
 *
 *  - encrypted-bundle.json: network-first, with cache=no-cache so we
 *    always revalidate with GitHub Pages instead of trusting the browser's
 *    HTTP cache (GH Pages caches for 10min by default). If the network
 *    request takes longer than NETWORK_TIMEOUT_MS or the user is fully
 *    offline we fall back to the cached copy. Additionally we only cache
 *    successful HTTP 2xx responses — never 404/500/503 which would
 *    otherwise pin a device to a failed deploy for hours.
 *
 * Bump CACHE_VERSION whenever the shell file list changes, so old caches
 * get cleaned up on activate instead of accumulating forever. Bumping also
 * triggers a new install event so clients pick up changes: skipWaiting +
 * clients.claim activate the new SW immediately on next refresh, and
 * app.js listens for 'updatefound' to prompt the user to reload so the
 * in-memory JS bundle also swaps to the newly installed code (otherwise
 * new SW but old cipherEngine.js in memory could desync).
 */

const CACHE_VERSION = 'tango-cifrado-v13';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const BUNDLE_CACHE = `${CACHE_VERSION}-bundle`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const NETWORK_TIMEOUT_MS = 5000;

// Set to false for production to reduce console noise for end users.
// Set to true during development to debug cache lifecycle issues.
const DEBUG_LOGS = false;

const SHELL_FILES = [
  './',
  './index.html',
  './app.js',
  './cipherEngine.js',
  './secure-vault.js',
  './core/transport/types.js',
  './core/transport/chunked-text.js',
  './core/transport/document.js',
  './core/transport/server-bridge.js',
  './core/transport/index.js',
  './core/receive/from-query-param.js',
  './core/receive/from-shared-file.js',
  './core/receive/from-server-push.js',
  './core/receive/index.js',
  './manifest.json',
  './fonts/IBMPlexMono-Regular.ttf',
  './fonts/IBMPlexMono-Bold.ttf',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

const SHELL_SCOPE = new URL('./', self.location);
const SHELL_URLS_RESOLVED = SHELL_FILES.map(rel => new URL(rel, self.location).pathname);

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then(cache =>
        Promise.allSettled(
          SHELL_FILES.map(url => {
            const request = new Request(url, { cache: 'reload' });
            return fetch(request).then(response => {
              if (!response.ok) {
                throw new Error(`Shell precache ${url} -> HTTP ${response.status}`);
              }
              return cache.put(request, response);
            });
          })
        ).then(results => {
          const ok = results.filter(r => r.status === 'fulfilled').length;
          const fail = results.filter(r => r.status === 'rejected');
          if (fail.length > 0) {
            console.warn(
              '[SW install] algunos shell fallaron:',
              fail.map(r => r.reason && r.reason.message)
            );
          }
          if (DEBUG_LOGS) {
            console.log(`[SW install] precache ${ok}/${SHELL_FILES.length} shell files OK.`);
          }
        })
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== SHELL_CACHE && key !== BUNDLE_CACHE && key !== RUNTIME_CACHE)
            .map(key => caches.delete(key))
        )
      )
      .then(deleted => {
        if (DEBUG_LOGS) {
          console.log(`[SW activate] purged ${deleted.filter(Boolean).length} old caches.`);
        }
        return self.clients.claim();
      })
  );
});

function isBundleRequest(url) {
  return url.pathname.endsWith('encrypted-bundle.json');
}

function isShellRequest(url) {
  if (SHELL_URLS_RESOLVED.includes(url.pathname)) return true;
  const scopePath = SHELL_SCOPE.pathname;
  if (url.pathname === scopePath) return true;
  if (url.pathname + '/' === scopePath) return true;
  return false;
}

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const sharedFile = formData.get('shared_file');
    
    if (sharedFile && sharedFile instanceof File) {
      // Store the file content temporarily in IndexedDB so the app can access it
      // We'll use a simple key-value approach with a timestamp-based cleanup
      const fileContent = await sharedFile.text();
      const timestamp = Date.now();
      
      // Open IndexedDB to store the shared file temporarily
      const dbRequest = indexedDB.open('TangoCifradoSharedFiles', 1);
      
      return new Promise((resolve) => {
        dbRequest.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('files')) {
            db.createObjectStore('files', { keyPath: 'id' });
          }
        };
        
        dbRequest.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction(['files'], 'readwrite');
          const store = tx.objectStore('files');
          
          // Store file with timestamp-based ID
          store.put({
            id: 'latest',
            content: fileContent,
            filename: sharedFile.name,
            timestamp: timestamp
          });
          
          tx.oncomplete = () => {
            db.close();
            // Redirect to the app with a flag indicating a shared file is available
            const redirectUrl = new URL(request.url);
            redirectUrl.searchParams.set('shared_file_ready', '1');
            resolve(Response.redirect(redirectUrl.toString(), 302));
          };
          
          tx.onerror = () => {
            db.close();
            // Fallback: redirect to app without shared file
            resolve(Response.redirect(new URL('./', self.location).toString(), 302));
          };
        };
        
        dbRequest.onerror = () => {
          // Fallback: redirect to app without shared file  
          resolve(Response.redirect(new URL('./', self.location).toString(), 302));
        };
      });
    }
    
    // No file or invalid file: redirect to main app
    return Response.redirect(new URL('./', self.location).toString(), 302);
  } catch (err) {
    console.warn('[SW] Share target error:', err);
    // Fallback: redirect to main app
    return Response.redirect(new URL('./', self.location).toString(), 302);
  }
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never intercept calls to the Telegram API — those must always hit
  // the network live, and failures there are handled by app.js/telegram
  // client logic, not the service worker.
  if (url.hostname === 'api.telegram.org') return;

  // Handle Web Share Target POST requests
  if (event.request.method === 'POST' && url.searchParams.get('src') === 'shared-file') {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  if (event.request.method !== 'GET') return;

  if (isBundleRequest(url)) {
    event.respondWith(
      Promise.race([
        fetch(event.request, { cache: 'no-cache' }).then(response => {
          if (!response.ok) {
            throw new Error(`Bundle fetch HTTP ${response.status}`);
          }
          const copy = response.clone();
          caches.open(BUNDLE_CACHE).then(cache => cache.put(event.request, copy));
          return response;
        }),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Bundle fetch timed out')), NETWORK_TIMEOUT_MS);
        }),
      ]).catch(err => {
        console.warn('[SW fetch] bundle network failed, fallback to cache.', err && err.message);
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          return new Response(
            JSON.stringify({ error: 'offline-no-cache', detail: err && err.message }),
            {
              status: 504,
              statusText: 'Gateway Timeout',
              headers: { 'Content-Type': 'application/json', 'X-Tango-Offline': '1' },
            }
          );
        });
      })
    );
    return;
  }

  if (isShellRequest(url)) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request, { cache: 'reload' }).then(net => {
          if (net.ok) {
            const copy = net.clone();
            caches.open(SHELL_CACHE).then(c => c.put(event.request, copy));
          }
          return net;
        });
      })
    );
    return;
  }

  // Anything else: try network, fall back to cache if present.
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
      .then(net => {
        if (net.ok) {
          const copy = net.clone();
          caches.open(RUNTIME_CACHE).then(c => c.put(event.request, copy));
        }
        return net;
      })
      .catch(() => caches.match(event.request))
  );
});

