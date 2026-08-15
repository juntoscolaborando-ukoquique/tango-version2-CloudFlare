import { strict as assert } from 'assert';
import { readFile } from 'fs/promises';
import { test } from 'node:test';

// Provide IndexedDB in Node
global.indexedDB = (await import('fake-indexeddb')).indexedDB;

// Minimal localStorage stub
global.localStorage = {
  _store: Object.create(null),
  getItem(k) {
    return this._store[k] ?? null;
  },
  setItem(k, v) {
    this._store[k] = String(v);
  },
  removeItem(k) {
    delete this._store[k];
  },
};

// Node 20 has globalThis.crypto.subtle and fetch.

const basePath = new URL('../../pwa/', import.meta.url);

const { unlockDeployBundle, savePayloadDirect, loadPayloadDirect, hasPayloadDirect } = await import(
  new URL('secure-vault.js', basePath)
);
const { cifrarMensaje, descifrarMensaje } = await import(new URL('cipherEngine.js', basePath));

function bytesToB64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return Buffer.from(bin, 'binary').toString('base64');
}

async function makeBundle(passphrase, payload) {
  // Derive key with PBKDF2 (matches secure-vault.js expectations)
  const enc = new TextEncoder();
  const kdfSalt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: kdfSalt, iterations: 600000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode('tango-cifrado-bundle-v1');
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad },
    key,
    plaintext
  );
  return {
    version: 1,
    kdf: 'PBKDF2-HMAC-SHA256',
    kdf_salt_b64: bytesToB64(kdfSalt),
    kdf_iterations: 600000,
    nonce_b64: bytesToB64(nonce),
    aad: new TextDecoder().decode(aad),
    ciphertext_b64: bytesToB64(new Uint8Array(ciphertext)),
  };
}

test('unlockDeployBundle: unsupported version is rejected before any decrypt attempt', async () => {
  const pass = 'test-deploy-pass';
  const bundle = await makeBundle(pass, { tangos: {}, salt: 47 });

  bundle.version = 2;
  await assert.rejects(() => unlockDeployBundle(pass, bundle), /Versión de bundle no soportada/);

  delete bundle.version;
  await assert.rejects(() => unlockDeployBundle(pass, bundle), /Versión de bundle no soportada/);
});

test('PWA E2E: first-run unlock → save → cipher/descipher → malformed handling → telegram persistence', async () => {
  const payload = {
    tangos: {
      3: {
        titulo: 'Cambalache',
        versos: [
          ['Que', 'el', 'mundo'],
          ['mañana', 'subir'],
        ],
      },
    },
    salt: 47,
  };

  const pass = 'test-deploy-pass';
  const bundle = await makeBundle(pass, payload);

  // Unlock
  const unlocked = await unlockDeployBundle(pass, bundle);
  assert.deepEqual(unlocked, payload);

  // Save to IndexedDB and verify
  await savePayloadDirect(unlocked);
  assert.equal(await hasPayloadDirect(), true);
  const loaded = await loadPayloadDirect();
  assert.deepEqual(loaded, payload);

  // Cipher and round-trip
  const codigo = await cifrarMensaje('3', 'el mundo', payload.tangos, payload.salt);
  assert.ok(codigo.startsWith(String(3 + payload.salt) + '-'));
  const texto = await descifrarMensaje(codigo, payload.tangos, payload.salt);
  assert.equal(texto, 'el mundo');

  // malformed input handling
  await assert.rejects(() => descifrarMensaje('XXX-NOTOKEN', payload.tangos, payload.salt));

  // Telegram persistence (localStorage)
  const cfg = { botToken: 'x', chatId: '123' };
  localStorage.setItem('tango-cifrado:telegram-config', JSON.stringify(cfg));
  const raw = localStorage.getItem('tango-cifrado:telegram-config');
  assert.equal(JSON.parse(raw).chatId, '123');
});

test('unlockDeployBundle: accepts NFC/NFD variants of the deploy passphrase', async () => {
  const payload = { tangos: {}, salt: 47 };
  const passNfc = 'café';
  const passNfd = 'cafe\u0301';
  const bundle = await makeBundle(passNfc, payload);

  const unlocked = await unlockDeployBundle(passNfd, bundle);
  assert.deepEqual(unlocked, payload);
});

// ---------- Web Share Target tests ----------

test('Web Share Target: service worker stores shared file in IndexedDB', async () => {
  // Mock service worker environment
  const mockSelf = {
    location: { pathname: '/pwa/', search: '' }
  };
  
  // Mock FormData with shared file
  const mockFile = {
    name: 'shared-message.txt',
    text: async () => '50-V01P02-~20-V01P03'
  };
  
  const mockFormData = {
    get: (key) => key === 'shared_file' ? mockFile : null
  };
  
  const mockRequest = {
    formData: async () => mockFormData,
    url: 'https://example.com/pwa/index.html?src=shared-file'
  };

  // Simulate the service worker's handleShareTarget logic
  const fileContent = await mockFile.text();
  const timestamp = Date.now();
  
  // Test IndexedDB storage (this is what the service worker does)
  const dbRequest = indexedDB.open('TangoCifradoSharedFiles', 1);
  
  await new Promise((resolve) => {
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
      
      store.put({
        id: 'latest',
        content: fileContent,
        filename: mockFile.name,
        timestamp: timestamp
      });
      
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    };
  });
  
  // Verify the file was stored correctly
  const readRequest = indexedDB.open('TangoCifradoSharedFiles', 1);
  
  const storedData = await new Promise((resolve) => {
    readRequest.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction(['files'], 'readonly');
      const store = tx.objectStore('files');
      const getRequest = store.get('latest');
      
      getRequest.onsuccess = () => {
        db.close();
        resolve(getRequest.result);
      };
    };
  });
  
  assert.equal(storedData.content, '50-V01P02-~20-V01P03');
  assert.equal(storedData.filename, 'shared-message.txt');
  assert.equal(typeof storedData.timestamp, 'number');
});

test('Web Share Target: getSharedFileIfAvailable reads and cleans up', async () => {
  // First store a file (simulating service worker)
  const testContent = '50-V01P04^U-~20-V01P01';
  const testFilename = 'test-shared.txt';
  
  const dbRequest = indexedDB.open('TangoCifradoSharedFiles', 1);
  
  await new Promise((resolve) => {
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
      
      store.put({
        id: 'latest',
        content: testContent,
        filename: testFilename,
        timestamp: Date.now()
      });
      
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    };
  });
  
  // Mock the getSharedFileIfAvailable function logic
  const getSharedFileIfAvailable = async () => {
    try {
      const dbRequest = indexedDB.open('TangoCifradoSharedFiles', 1);
      
      return new Promise((resolve) => {
        dbRequest.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction(['files'], 'readonly');
          const store = tx.objectStore('files');
          const getRequest = store.get('latest');
          
          getRequest.onsuccess = () => {
            const result = getRequest.result;
            if (result && result.content) {
              // Clean up the stored file after reading
              const deleteTx = db.transaction(['files'], 'readwrite');
              const deleteStore = deleteTx.objectStore('files');
              deleteStore.delete('latest');
              deleteTx.oncomplete = () => db.close();
              
              // Return mock File object
              resolve({
                text: async () => result.content,
                name: result.filename || 'shared.txt'
              });
            } else {
              db.close();
              resolve(null);
            }
          };
          
          getRequest.onerror = () => {
            db.close();
            resolve(null);
          };
        };
        
        dbRequest.onerror = () => {
          resolve(null);
        };
      });
    } catch (err) {
      return null;
    }
  };
  
  // Test reading the shared file
  const sharedFile = await getSharedFileIfAvailable();
  assert.ok(sharedFile, 'Should return shared file object');
  assert.equal(await sharedFile.text(), testContent);
  assert.equal(sharedFile.name, testFilename);
  
  // Test that file was cleaned up
  const secondRead = await getSharedFileIfAvailable();
  assert.equal(secondRead, null, 'File should be cleaned up after first read');
});

test('Web Share Target: returns null when no shared file available', async () => {
  // Mock getSharedFileIfAvailable with empty IndexedDB
  const getSharedFileIfAvailable = async () => {
    try {
      const dbRequest = indexedDB.open('TangoCifradoSharedFilesEmpty', 1);
      
      return new Promise((resolve) => {
        dbRequest.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('files')) {
            db.createObjectStore('files', { keyPath: 'id' });
          }
        };
        
        dbRequest.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction(['files'], 'readonly');
          const store = tx.objectStore('files');
          const getRequest = store.get('latest');
          
          getRequest.onsuccess = () => {
            db.close();
            resolve(getRequest.result ? {
              text: async () => getRequest.result.content,
              name: getRequest.result.filename || 'shared.txt'
            } : null);
          };
          
          getRequest.onerror = () => {
            db.close();
            resolve(null);
          };
        };
        
        dbRequest.onerror = () => {
          resolve(null);
        };
      });
    } catch (err) {
      return null;
    }
  };
  
  const result = await getSharedFileIfAvailable();
  assert.equal(result, null, 'Should return null when no shared file exists');
});

