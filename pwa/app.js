/**
 * app.js
 *
 * Wires together secure-vault.js (credential/corpus storage) and
 * cipherEngine.js (the cipher itself) into the actual UI, following the
 * frictionless flow documented in TECH_SPECS_CIFRADO_TANGOS.md Paso 5:
 *
 *   First run:  hasPayloadDirect() -> false -> ask CLAVE_DESPLIEGUE ->
 *               fetch encrypted-bundle.json -> unlockDeployBundle() ->
 *               savePayloadDirect({ tangos, salt })
 *
 *   Every other day: loadPayloadDirect() -> straight to the composer,
 *               no password.
 *
 * DEFAULT MODE (frictionless, matches secure-vault.js's own docs): the
 * unlocked payload sits in IndexedDB as plain JSON on this device. That is
 * a conscious trade-off in favor of zero daily friction, not an oversight.
 *
 * OPT-IN PIN MODE: Settings > "Seguridad del dispositivo" lets the user
 * switch to the PIN-gated device vault (sealForDevice/openDeviceVault from
 * secure-vault.js) instead. In that mode the app asks for a PIN on every
 * open (handlePinUnlockSubmit) rather than loading straight into the
 * composer. Which mode is active is tracked in
 * localStorage[VAULT_MODE_KEY] and mirrored in the module-level `vaultMode`
 * variable below.
 *
 * Telegram bot token + chat id are separate from the tango corpus: they're
 * this user's own delivery-channel credentials, not the cipher secret.
 *   - Frictionless mode: kept in localStorage, same as before. Losing them
 *     only means re-typing a bot token, not re-deriving the cipher.
 *   - PIN mode: kept *inside* the sealed vault payload alongside the corpus
 *     (see TO_FIX.md P3-3) — on a lost/stolen device in PIN mode, an
 *     attacker who can't open the vault also can't send Telegram messages
 *     impersonating the user.
 */

import { cifrarMensaje, descifrarMensaje } from './cipherEngine.js';
import { sendCiphertext } from './core/transport/index.js';
import { resolveIncoming } from './core/receive/index.js';
import { loadTCMPConfig } from './core/tcmp/storage.js';
import { createDevice, getRoster, sendText, sendAttachment, pollInbox } from './core/tcmp/index.js';
import { documentFromEditable, renderRichText } from './core/tcmp/richtext-dom.js';
import {
  unlockDeployBundle,
  savePayloadDirect,
  loadPayloadDirect,
  hasPayloadDirect,
  deletePayloadDirect,
  sealForDevice,
  openDeviceVault,
  saveSealedVault,
  loadSealedVault,
  hasSealedVault,
  deleteSealedVault,
} from './secure-vault.js';

const TELEGRAM_CONFIG_KEY = 'tango-cifrado:telegram-config';
const VAULT_MODE_KEY = 'tango-cifrado:vault-mode'; // 'direct' | 'pin'
const BUNDLE_URL = './encrypted-bundle.json';

// ---------- state ----------

let payload = null; // { tangos, salt } in direct mode; { tangos, salt, telegram } in pin mode
let mode = 'cifrar'; // 'cifrar' | 'descifrar'
let bundleGeneratedAt = null; // ISO string from the fetched bundle's plaintext metadata, or null
let vaultMode = 'direct'; // 'direct' | 'pin' -- resolved from localStorage at boot
let sessionPin = null; // the PIN used to open the device vault this session, kept in
// memory only (never persisted) so Settings can re-seal the vault after an
// edit (e.g. saving new Telegram credentials) without prompting for the PIN
// again on every save. Cleared on "Desactivar PIN" and on page reload.

// Inactivity / session expiry for PIN mode
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
let _inactivityTimer = null;
let tcmpConfig = loadTCMPConfig();
let tcmpRoster = [];
let pendingTCMP = null;
let inboxTimer = null;

function clearSessionForPinTimeout() {
  if (vaultMode !== 'pin') return;
  sessionPin = null;
  payload = null;
  try {
    setStatus($('#pin-unlock-status'), 'Sesión expirada por inactividad. Ingresá el PIN de nuevo.', 'info');
  } catch (e) {}
  showScreen('pin-unlock');
}

function resetInactivityTimer() {
  if (vaultMode !== 'pin' || !sessionPin) return;
  if (_inactivityTimer) clearTimeout(_inactivityTimer);
  _inactivityTimer = setTimeout(() => {
    clearSessionForPinTimeout();
  }, INACTIVITY_TIMEOUT_MS);
}

// Reset on common UI events; passive listeners to avoid blocking.
['mousemove', 'keydown', 'touchstart', 'click'].forEach(evt =>
  document.addEventListener(evt, resetInactivityTimer, { passive: true })
);

// When the page is hidden, immediately invalidate the unlocked PIN for safety.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearSessionForPinTimeout();
  } else {
    resetInactivityTimer();
  }
});

// Clear sessionPin on unload to avoid leaving it in memory when the page
// is closed or navigated away from.
window.addEventListener('beforeunload', () => {
  if (vaultMode === 'pin') sessionPin = null;
});

// ---------- small DOM helpers ----------

const $ = sel => document.querySelector(sel);

function showScreen(name) {
  $('#unlock-screen').hidden = name !== 'unlock';
  $('#pin-unlock-screen').hidden = name !== 'pin-unlock';
  $('#app-screen').hidden = name !== 'app';
}

function setStatus(el, message, kind = 'info') {
  el.textContent = message;
  el.dataset.kind = message ? kind : '';
}

function iterTangos(tangos) {
  // Mirrors iter_tangos() in cipher_engine.py: skip metadata keys like
  // '_nota' and anything that isn't a real tango record.
  return Object.entries(tangos).filter(
    ([clave, valor]) => !clave.startsWith('_') && typeof valor === 'object' && valor !== null
  );
}

// ---------- Telegram config (storage location depends on vaultMode) ----------

function loadTelegramConfigFromLocalStorage() {
  try {
    const raw = localStorage.getItem(TELEGRAM_CONFIG_KEY);
    return raw ? JSON.parse(raw) : { botToken: '', chatId: '' };
  } catch {
    return { botToken: '', chatId: '' };
  }
}

function saveTelegramConfigToLocalStorage(config) {
  localStorage.setItem(TELEGRAM_CONFIG_KEY, JSON.stringify(config));
}

/**
 * Reads the current Telegram config from wherever this vaultMode keeps it:
 * localStorage in direct mode, or the (already-unlocked, in-memory) sealed
 * payload in pin mode. Always returns synchronously -- pin mode never hits
 * IndexedDB here because the vault is already open in `payload` by the time
 * any screen that needs this has been reached.
 */
function getTelegramConfig() {
  if (vaultMode === 'pin') {
    return (payload && payload.telegram) || { botToken: '', chatId: '' };
  }
  return loadTelegramConfigFromLocalStorage();
}

/**
 * Persists a new Telegram config to wherever this vaultMode keeps it. In pin
 * mode this re-seals the whole vault under `sessionPin` -- there's no way to
 * update just the Telegram fields inside an AES-GCM ciphertext without
 * re-encrypting the payload it's part of.
 */
async function setTelegramConfig(config) {
  if (vaultMode === 'pin') {
    if (!sessionPin || !payload) {
      throw new Error('La bóveda no está abierta -- no se puede guardar.');
    }
    payload.telegram = config;
    const sealed = await sealForDevice(sessionPin, payload);
    await saveSealedVault(sealed);
  } else {
    saveTelegramConfigToLocalStorage(config);
  }
}

// ---------- vault mode (direct vs PIN-gated) ----------

function getVaultMode() {
  return localStorage.getItem(VAULT_MODE_KEY) === 'pin' ? 'pin' : 'direct';
}

function setVaultMode(newMode) {
  localStorage.setItem(VAULT_MODE_KEY, newMode);
  vaultMode = newMode;
}

function syncTCMPFromPayload() {
  if (payload?.tcmp) tcmpConfig = { ...tcmpConfig, ...payload.tcmp };
}

async function persistTCMPConfig() {
  if (!payload) return;
  payload.tcmp = { ...tcmpConfig };
  if (vaultMode === 'pin') {
    if (!sessionPin) throw new Error('La bóveda PIN no está abierta.');
    const sealed = await sealForDevice(sessionPin, payload);
    await saveSealedVault(sealed);
  } else {
    await savePayloadDirect(payload);
  }
}

// ---------- first-run unlock ----------

async function handleUnlockSubmit(event) {
  event.preventDefault();
  const claveInput = $('#clave-despliegue');
  const statusEl = $('#unlock-status');
  const button = $('#unlock-submit');

  const claveDespliegue = claveInput.value.trim();
  if (!claveDespliegue) {
    setStatus(statusEl, 'Ingresá la clave de despliegue.', 'error');
    return;
  }

  button.disabled = true;
  setStatus(statusEl, 'Descargando paquete cifrado…', 'info');

  try {
    const resp = await fetch(BUNDLE_URL, { cache: 'no-cache' });
    if (!resp.ok) {
      if (resp.headers.get('X-Tango-Offline') === '1') {
        throw new Error(
          'Sin conexión y no hay una copia guardada del paquete cifrado. ' +
            'Conectate a internet y probá de nuevo.'
        );
      }
      throw new Error(`No se pudo descargar ${BUNDLE_URL} (${resp.status})`);
    }
    const bundle = await resp.json();

    setStatus(statusEl, 'Descifrando…', 'info');
    payload = await unlockDeployBundle(claveDespliegue, bundle);

    if (bundle.generated_at) {
      bundleGeneratedAt = bundle.generated_at;
      localStorage.setItem(BUNDLE_GENERATED_AT_KEY, bundle.generated_at);
      showBundleGeneratedAt(bundle.generated_at);
    }

    // Store generated_at inside the payload so the corpus-freshness
    // check in init() can detect when a newer bundle has been deployed.
    payload.bundle_generated_at = bundle.generated_at || null;

    setVaultMode('direct');
    await savePayloadDirect(payload);
    claveInput.value = '';

    setStatus(statusEl, '', 'info');
    enterComposer();
    await refreshTCMPRoster();
    startTCMPInboxPolling();
  } catch (err) {
    setStatus(statusEl, err.message || 'No se pudo desbloquear el paquete.', 'error');
  } finally {
    button.disabled = false;
  }
}

// ---------- PIN unlock (device vault, opt-in) ----------

async function handlePinUnlockSubmit(event) {
  event.preventDefault();
  const pinInput = $('#device-pin');
  const statusEl = $('#pin-unlock-status');
  const button = $('#pin-unlock-submit');

  const pin = pinInput.value;
  if (!pin) {
    setStatus(statusEl, 'Ingresá tu PIN.', 'error');
    return;
  }

  button.disabled = true;
  setStatus(statusEl, 'Verificando…', 'info');

  try {
    const sealed = await loadSealedVault();
    if (!sealed) {
      // Shouldn't normally happen (init() only shows this screen when
      // hasSealedVault() was true), but IndexedDB can be cleared out
      // from under the app -- fail with a clear message instead of a
      // confusing decrypt error.
      throw new Error('No se encontró la bóveda protegida en este dispositivo.');
    }
    const opened = await openDeviceVault(pin, sealed);
    payload = opened; // { tangos, salt, telegram }
    sessionPin = pin;
    pinInput.value = '';

    setStatus(statusEl, '', 'info');
    enterComposer();
    await refreshTCMPRoster();
    startTCMPInboxPolling();
  } catch (err) {
    setStatus(statusEl, err.message || 'PIN incorrecto.', 'error');
  } finally {
    button.disabled = false;
  }
}

// ---------- composer ----------

function populateTangoSelect() {
  const select = $('#tango-select');
  if (!select) return;
  select.innerHTML = '';
  for (const [id, tango] of iterTangos(payload.tangos)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `${id} — ${tango.titulo}`;
    select.appendChild(opt);
  }
}

function populateRecipientSelect() {
  const select = $('#recipient-select');
  if (!select) return;
  select.innerHTML = '';
  if (!tcmpRoster.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Sin destinatarios disponibles';
    select.appendChild(opt);
    return;
  }
  for (const device of tcmpRoster) {
    if (device.device_id === tcmpConfig.deviceId) continue;
    const opt = document.createElement('option');
    opt.value = device.device_id;
    opt.textContent = `${device.user_id} — ${device.device_id}`;
    select.appendChild(opt);
  }
}

async function refreshTCMPRoster() {
  if (!tcmpConfig.baseUrl || !tcmpConfig.deviceToken || !tcmpConfig.deviceId) {
    tcmpRoster = [];
    populateRecipientSelect();
    return;
  }
  try {
    const result = await getRoster(tcmpConfig);
    tcmpRoster = result.devices || [];
    populateRecipientSelect();
    setStatus($('#composer-status'), `Conectado a Cloudflare · ${Math.max(0, tcmpRoster.length - 1)} destinatarios.`, 'info');
  } catch (err) {
    console.warn('[TCMP] roster:', err);
    setStatus($('#composer-status'), 'No se pudo actualizar la lista de destinatarios.', 'error');
  }
}

function getEditor() { return $('#message-editor'); }
function getComposerText() {
  const editor = getEditor();
  return editor ? editor.innerText : $('#message-input').value;
}
function setComposerText(text) {
  const editor = getEditor();
  if (editor) editor.textContent = text;
  $('#message-input').value = text;
}
function isRichMode() { return !!$('#rich-mode')?.checked; }

function renderCoordinateStrip(codigoCifrado) {
  const strip = $('#output-strip');
  strip.innerHTML = '';
  const partes = codigoCifrado.split('-');
  partes.forEach((token, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip' + (i === 0 ? ' chip--key' : '');
    chip.textContent = token || '·';
    strip.appendChild(chip);
  });
}

function renderPlainOutput(text) {
  const strip = $('#output-strip');
  strip.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'plain-output';
  p.textContent = text;
  strip.appendChild(p);
}

function setMode(newMode) {
  mode = newMode;
  $('#mode-cifrar').classList.toggle('is-active', mode === 'cifrar');
  $('#mode-descifrar').classList.toggle('is-active', mode === 'descifrar');
  $('#tango-field').hidden = mode !== 'cifrar';
  $('#recipient-field').hidden = mode !== 'cifrar';
  $('#rich-field').hidden = mode !== 'cifrar';
  $('#attachment-field').hidden = mode !== 'cifrar';
  $('#open-file-row').hidden = mode !== 'descifrar';
  const editor = getEditor();
  if (editor) editor.hidden = false;
  $('#message-input').hidden = true;
  $('#message-label').textContent = mode === 'cifrar' ? 'Mensaje' : 'Código cifrado legado';
  $('#run-action').textContent = mode === 'cifrar' ? 'Preparar' : 'Descifrar legado';
  if (mode === 'descifrar') $('#message-input').hidden = false;
  $('#output-strip').innerHTML = '';
  $('#send-row').hidden = true;
  $('#send-row').dataset.cipherText = '';
  setStatus($('#composer-status'), '', 'info');
}

async function handleRunAction() {
  const statusEl = $('#composer-status');
  setStatus(statusEl, '', 'info');
  $('#send-row').hidden = true;
  pendingTCMP = null;

  if (mode === 'descifrar') {
    const input = $('#message-input').value;
    if (!input.trim()) { setStatus(statusEl, 'Pegá un código cifrado legado.', 'error'); return; }
    try {
      const texto = await descifrarMensaje(input, payload.tangos, payload.salt);
      renderPlainOutput(texto);
    } catch (err) { setStatus(statusEl, err.message || 'No se pudo descifrar.', 'error'); }
    return;
  }

  const recipientDeviceId = $('#recipient-select')?.value;
  if (!tcmpConfig.deviceToken || !tcmpConfig.deviceId) {
    setStatus(statusEl, 'Primero configurá y registrá este dispositivo en Cloudflare.', 'error');
    $('#tcmp-settings-panel').hidden = false;
    return;
  }
  if (!recipientDeviceId) { setStatus(statusEl, 'Elegí un destinatario.', 'error'); return; }

  const file = $('#attachment-input')?.files?.[0] || null;
  const textValue = getComposerText();
  if (!textValue.trim() && !file) { setStatus(statusEl, 'Escribí un mensaje o seleccioná un archivo.', 'error'); return; }

  try {
    if (file) {
      pendingTCMP = { kind: 'attachment', file, recipientDeviceId, caption: textValue, richDocument: isRichMode() ? documentFromEditable(getEditor()) : null };
      $('#output-strip').textContent = `Adjunto listo: ${file.name} (${Math.round(file.size / 1024)} KiB)`;
    } else {
      pendingTCMP = { kind: isRichMode() ? 'richtext' : 'text', recipientDeviceId, text: textValue, richDocument: isRichMode() ? documentFromEditable(getEditor()) : null };
      $('#output-strip').textContent = isRichMode() ? 'Texto enriquecido listo para enviar.' : 'Mensaje listo para enviar.';
    }
    $('#send-row').hidden = false;
    setStatus(statusEl, 'Listo. Revisá el destinatario y tocá Enviar.', 'success');
  } catch (err) { setStatus(statusEl, err.message || 'No se pudo preparar el mensaje.', 'error'); }
}

async function handleCopy() {
  try {
    const text = $('#send-row').dataset.cipherText || getComposerText();
    await navigator.clipboard.writeText(text);
    setStatus($('#composer-status'), 'Copiado.', 'success');
  } catch { setStatus($('#composer-status'), 'No se pudo copiar.', 'error'); }
}

async function handleSend() {
  const statusEl = $('#composer-status');
  const button = $('#send-button');
  button.disabled = true;
  try {
    if (pendingTCMP) {
      if (pendingTCMP.kind === 'attachment') {
        setStatus(statusEl, 'Cifrando y subiendo adjunto…', 'info');
        await sendAttachment({ config: tcmpConfig, corpus: payload.tangos, file: pendingTCMP.file, recipientDeviceId: pendingTCMP.recipientDeviceId, caption: pendingTCMP.caption, richDocument: pendingTCMP.richDocument, onProgress: p => setStatus(statusEl, `Subiendo adjunto… ${Math.round(p * 100)}%`, 'info') });
      } else {
        setStatus(statusEl, 'Cifrando y enviando…', 'info');
        await sendText({ config: tcmpConfig, corpus: payload.tangos, text: pendingTCMP.text, recipientDeviceId: pendingTCMP.recipientDeviceId, richDocument: pendingTCMP.richDocument });
      }
      setStatus(statusEl, 'Enviado por Cloudflare.', 'success');
      $('#send-row').hidden = true;
      pendingTCMP = null;
      if ($('#attachment-input')) $('#attachment-input').value = '';
      return;
    }

    // Legacy Telegram fallback remains available for old ciphertexts.
    const { botToken, chatId } = getTelegramConfig();
    if (!botToken || !chatId) throw new Error('No hay un mensaje TCMP pendiente y tampoco está configurado Telegram legacy.');
    const codigo = $('#send-row').dataset.cipherText;
    setStatus(statusEl, 'Enviando por Telegram legacy…', 'info');
    await sendCiphertext(codigo, { botToken, chatId, origin: location.origin, pathname: location.pathname, search: location.search });
    setStatus(statusEl, 'Enviado por Telegram legacy.', 'success');
  } catch (err) {
    setStatus(statusEl, err.message || 'No se pudo enviar.', 'error');
  } finally { button.disabled = false; }
}

async function pollTCMPInboxOnce() {
  if (!tcmpConfig.deviceToken || !payload?.tangos) return;
  try {
    const messages = await pollInbox({ config: tcmpConfig, corpus: payload.tangos });
    for (const message of messages) {
      await presentTCMPMessage(message);
    }
  } catch (err) {
    console.warn('[TCMP] inbox:', err);
  }
}

async function presentTCMPMessage(message) {
  const { value } = message;
  setMode('cifrar');
  if (value.type === 'text') {
    setComposerText(value.text);
    $('#output-strip').textContent = 'Mensaje recibido por Cloudflare.';
  } else if (value.type === 'richtext') {
    $('#rich-mode').checked = true;
    renderRichText(value.document, getEditor());
    $('#output-strip').textContent = 'Texto enriquecido recibido por Cloudflare.';
  } else if (value.type === 'attachment') {
    const blob = new Blob([value.bytes], { type: value.manifest.mime });
    const url = URL.createObjectURL(blob);
    $('#output-strip').innerHTML = '';
    const link = document.createElement('a');
    link.href = url; link.download = value.manifest.filename; link.textContent = `Descargar ${value.manifest.filename}`;
    link.style.color = 'var(--brass)';
    $('#output-strip').appendChild(link);
    if (value.manifest.caption) setComposerText(value.manifest.caption);
  }
  setStatus($('#composer-status'), 'Nuevo contenido recibido.', 'success');
}

function startTCMPInboxPolling() {
  if (inboxTimer) clearInterval(inboxTimer);
  if (!tcmpConfig.deviceToken) return;
  pollTCMPInboxOnce();
  inboxTimer = setInterval(pollTCMPInboxOnce, 5000);
}

// ---------- settings ----------

const BUNDLE_GENERATED_AT_KEY = 'tango-cifrado:bundle-generated-at';

function showBundleGeneratedAt(iso) {
  const bundleInfo = $('#bundle-info');
  if (!bundleInfo || !iso) return;
  const fecha = new Date(iso);
  const texto = Number.isNaN(fecha.getTime())
    ? iso
    : fecha.toLocaleDateString('es', { year: 'numeric', month: 'long', day: 'numeric' });
  bundleInfo.textContent = `Corpus actualizado el ${texto}.`;
}

/**
 * Fetches the bundle's plaintext metadata and compares its generated_at
 * against what's stored in the local payload. If the server has a newer
 * bundle, wipes IndexedDB and localStorage so init() falls through to the
 * unlock screen and the user re-enters CLAVE_DESPLIEGUE to get the updated
 * corpus. Fails silently when offline — stale corpus is better than no app.
 */
async function checkBundleFreshness() {
  try {
    const resp = await fetch(BUNDLE_URL, { cache: 'no-cache' });
    if (!resp.ok) return;
    const bundle = await resp.json();
    const serverTs = bundle.generated_at;
    if (!serverTs) return;

    // Read the stored timestamp from whichever storage mode is active.
    let storedTs = null;
    if (vaultMode === 'pin') {
      const sealed = await loadSealedVault();
      // Can't open the sealed vault without the PIN here — read the
      // stored generated_at from localStorage as a proxy instead.
      storedTs = localStorage.getItem(BUNDLE_GENERATED_AT_KEY);
    } else {
      const stored = await loadPayloadDirect();
      storedTs =
        stored && stored.bundle_generated_at
          ? stored.bundle_generated_at
          : localStorage.getItem(BUNDLE_GENERATED_AT_KEY);
    }

    const serverHasNewer = (() => {
      if (!storedTs) return true;
      try {
        const s = new Date(serverTs).getTime();
        const t = new Date(storedTs).getTime();
        return Number.isFinite(s) && Number.isFinite(t) && s > t;
      } catch {
        return serverTs > storedTs;
      }
    })();

    if (serverHasNewer) {
      await deletePayloadDirect();
      await deleteSealedVault();
      localStorage.removeItem(BUNDLE_GENERATED_AT_KEY);
      setVaultMode('direct');
    }
  } catch {
    // Offline or fetch error — leave local storage untouched.
  }
}

// Runs on every app load. generated_at sits in the bundle's plaintext
// metadata, outside the AES-GCM ciphertext -- so this can update the
// displayed corpus date without touching CLAVE_DESPLIEGUE. Fails silently
// offline; whatever was last known (from localStorage) stays displayed.
async function refreshBundleGeneratedAt() {
  try {
    const resp = await fetch(BUNDLE_URL, { cache: 'no-cache' });
    if (!resp.ok) return;
    const bundle = await resp.json();
    if (bundle.generated_at) {
      localStorage.setItem(BUNDLE_GENERATED_AT_KEY, bundle.generated_at);
      showBundleGeneratedAt(bundle.generated_at);
    }
  } catch {
    // Offline, or the bundle isn't reachable right now -- not fatal,
    // the last known date (if any) is already shown from localStorage.
  }
}

// Reads the Telegram fields into the form. Split out from initSettings()
// because at boot time (initSettings runs once, before any vault is open)
// there's nothing to show yet in pin mode -- payload doesn't exist until
// handlePinUnlockSubmit or handleUnlockSubmit succeeds. Called again from
// enterComposer() once a payload is actually available.
function populateTelegramFields() {
  const { botToken, chatId } = getTelegramConfig();
  $('#bot-token').value = botToken;
  $('#chat-id').value = chatId;
}

function populateTCMPFields() {
  $('#tcmp-base-url').value = tcmpConfig.baseUrl || '';
  $('#tcmp-user-id').value = tcmpConfig.userId || '';
  $('#tcmp-device-id').value = tcmpConfig.deviceId || '';
  $('#tcmp-device-token').value = tcmpConfig.deviceToken || '';
}

function initTCMPSettings() {
  populateTCMPFields();
  $('#tcmp-settings-toggle').addEventListener('click', async () => {
    $('#tcmp-settings-panel').hidden = !$('#tcmp-settings-panel').hidden;
    if (!$('#tcmp-settings-panel').hidden) populateTCMPFields();
  });
  $('#tcmp-register-form').addEventListener('submit', async event => {
    event.preventDefault();
    const status = $('#tcmp-settings-status');
    try {
      const baseUrl = $('#tcmp-base-url').value.trim();
      const userId = $('#tcmp-user-id').value.trim();
      const bootstrapToken = $('#tcmp-bootstrap-token').value.trim();
      if (!baseUrl || !userId || !bootstrapToken) throw new Error('Servidor, usuario y token de bootstrap son obligatorios para registrar el dispositivo.');
      setStatus(status, 'Generando identidad y registrando dispositivo…', 'info');
      tcmpConfig = await createDevice({ baseUrl, userId, bootstrapToken });
      syncTCMPFromPayload();
      payload.tcmp = { ...tcmpConfig };
      await persistTCMPConfig();
      $('#tcmp-bootstrap-token').value = '';
      populateTCMPFields();
      await refreshTCMPRoster();
      startTCMPInboxPolling();
      setStatus(status, 'Dispositivo registrado y credenciales guardadas localmente.', 'success');
    } catch (err) { setStatus(status, err.message || 'No se pudo registrar.', 'error'); }
  });
  $('#tcmp-save-form').addEventListener('submit', async event => {
    event.preventDefault();
    tcmpConfig = { ...tcmpConfig, baseUrl: $('#tcmp-base-url').value.trim(), userId: $('#tcmp-user-id').value.trim(), deviceId: $('#tcmp-device-id').value.trim(), deviceToken: $('#tcmp-device-token').value.trim() };
    await persistTCMPConfig();
    setStatus($('#tcmp-settings-status'), 'Configuración TCMP guardada.', 'success');
    refreshTCMPRoster();
    startTCMPInboxPolling();
  });
}

function initSettings() {
  // Show whatever was last known immediately (no network wait); the
  // background refreshBundleGeneratedAt() call from init() will update
  // this in place if a fetch succeeds and finds a newer bundle.
  showBundleGeneratedAt(localStorage.getItem(BUNDLE_GENERATED_AT_KEY));

  $('#settings-toggle').addEventListener('click', () => {
    $('#settings-panel').hidden = !$('#settings-panel').hidden;
  });

  $('#settings-form').addEventListener('submit', async event => {
    event.preventDefault();
    const statusEl = $('#settings-status');
    try {
      await setTelegramConfig({
        botToken: $('#bot-token').value.trim(),
        chatId: $('#chat-id').value.trim(),
      });
      setStatus(statusEl, 'Guardado.', 'success');
    } catch (err) {
      setStatus(statusEl, err.message || 'No se pudo guardar.', 'error');
    }
  });
}

// ---------- security settings (direct <-> PIN-gated vault toggle) ----------

function updateSecurityPanel() {
  const modeStatus = $('#security-mode-status');
  const enableForm = $('#enable-pin-form');
  const disableButton = $('#disable-pin-button');

  if (vaultMode === 'pin') {
    setStatus(modeStatus, 'Este dispositivo está protegido con PIN.', 'success');
    enableForm.hidden = true;
    disableButton.hidden = false;
  } else {
    setStatus(
      modeStatus,
      'Sin PIN: cualquiera con acceso al dispositivo puede leer el corpus y las credenciales de Telegram.',
      'info'
    );
    enableForm.hidden = false;
    disableButton.hidden = true;
  }
}

function initSecuritySettings() {
  $('#security-toggle').addEventListener('click', () => {
    $('#security-panel').hidden = !$('#security-panel').hidden;
    if (!$('#security-panel').hidden) updateSecurityPanel();
  });

  $('#enable-pin-form').addEventListener('submit', handleEnablePin);
  $('#disable-pin-button').addEventListener('click', handleDisablePin);
}

// ---------- maintenance: full local reset (replaces manual TROUBLESHOOTING.md steps) ----------
//
// Does everything Opción A/B de TROUBLESHOOTING.md hacen a mano:
//   1. Desregistra el/los Service Worker(s) activos.
//   2. Borra TODOS los buckets de Cache Storage (shell/bundle/runtime, cualquier
//      CACHE_VERSION -- no hace falta saber el nombre exacto, se listan todos).
//   3. Borra las dos bases de IndexedDB: 'tango-cifrado-vault' (corpus/SALT
//      desbloqueados + credenciales Telegram) y 'TangoCifradoSharedFiles'
//      (buffer de Web Share Target).
//   4. Borra localStorage (incluye BUNDLE_GENERATED_AT_KEY y el resto de flags).
//   5. Recarga forzando bypass de HTTP cache, para que el próximo Service
//      Worker se instale desde cero -- mismo efecto que un hard-refresh.
//
// Deliberadamente NO es silencioso: pide confirmación porque borra el corpus
// desbloqueado (haría falta re-ingresar CLAVE_DESPLIEGUE) y cualquier
// credencial de Telegram guardada sin PIN activado.
async function clearAllLocalStateAndReload() {
  const statusEl = $('#maintenance-status');
  setStatus(statusEl, 'Vaciando caché…', 'info');

  const errors = [];

  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch (err) {
    errors.push(`Service Worker: ${err.message}`);
  }

  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (err) {
    errors.push(`Cache Storage: ${err.message}`);
  }

  for (const dbName of ['tango-cifrado-vault', 'TangoCifradoSharedFiles']) {
    try {
      await new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase(dbName);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error || new Error(`No se pudo borrar ${dbName}`));
        // onblocked: otra pestaña con la DB abierta. No es fatal -- seguimos
        // igual, el reload de más abajo suele liberarla.
        req.onblocked = () => resolve();
      });
    } catch (err) {
      errors.push(`IndexedDB ${dbName}: ${err.message}`);
    }
  }

  try {
    localStorage.clear();
  } catch (err) {
    errors.push(`localStorage: ${err.message}`);
  }

  if (errors.length) {
    // No abortamos el reload por esto -- lo importante (SW + caches) ya
    // corrió. Mostramos igual para que quede algo en pantalla si el
    // reload tarda o el usuario mira la consola después.
    console.warn('[maintenance] limpieza parcial, continuando de todos modos:', errors);
  }

  setStatus(statusEl, 'Listo. Reiniciando…', 'success');
  // location.reload() solo no alcanza si el navegador sirve el documento
  // principal desde su caché HTTP -- forzamos con timestamp para bypassear.
  window.location.href = window.location.pathname + '?_reset=' + Date.now();
}

function initMaintenance() {
  $('#maintenance-toggle').addEventListener('click', () => {
    $('#maintenance-panel').hidden = !$('#maintenance-panel').hidden;
  });

  $('#clear-cache-button').addEventListener('click', () => {
    const ok = window.confirm(
      'Esto va a borrar el corpus desbloqueado, las credenciales de Telegram guardadas ' +
      'y todo el caché de la app. Vas a tener que ingresar la clave de despliegue de ' +
      'nuevo. ¿Continuar?'
    );
    if (ok) clearAllLocalStateAndReload();
  });
}

async function handleEnablePin(event) {
  event.preventDefault();
  const statusEl = $('#security-status');
  const newPinInput = $('#new-pin');
  const confirmPinInput = $('#confirm-pin');
  const newPin = newPinInput.value;
  const confirmPin = confirmPinInput.value;

  if (!newPin || newPin.length < 4) {
    setStatus(statusEl, 'El PIN debe tener al menos 4 dígitos.', 'error');
    return;
  }
  if (newPin !== confirmPin) {
    setStatus(statusEl, 'Los PIN no coinciden.', 'error');
    return;
  }
  if (!payload) {
    setStatus(statusEl, 'Todavía no hay un corpus cargado.', 'error');
    return;
  }

  setStatus(statusEl, 'Activando PIN…', 'info');
  try {
    // Fold today's Telegram config (still in localStorage, since we're
    // coming from direct mode) into the payload that gets sealed, per
    // TO_FIX.md P3-3 -- from here on it lives inside the vault instead.
    const currentTelegram = loadTelegramConfigFromLocalStorage();
    const toSeal = { tangos: payload.tangos, salt: payload.salt, telegram: currentTelegram, tcmp: payload.tcmp || tcmpConfig };

    const sealed = await sealForDevice(newPin, toSeal);
    await saveSealedVault(sealed);
    await deletePayloadDirect();
    localStorage.removeItem(TELEGRAM_CONFIG_KEY);

    payload = toSeal;
    sessionPin = newPin;
    setVaultMode('pin');

    newPinInput.value = '';
    confirmPinInput.value = '';
    populateTelegramFields();
    setStatus(
      statusEl,
      'PIN activado. La próxima vez que abras la app, te lo va a pedir.',
      'success'
    );
    updateSecurityPanel();
  } catch (err) {
    setStatus(statusEl, err.message || 'No se pudo activar el PIN.', 'error');
  }
}

async function handleDisablePin() {
  const statusEl = $('#security-status');
  if (!sessionPin) {
    // Shouldn't be reachable in practice -- this button is only visible
    // after a successful PIN unlock in this same session -- but guard
    // against it anyway rather than silently failing sealForDevice below.
    setStatus(
      statusEl,
      'No se puede desactivar el PIN sin haberlo desbloqueado en esta sesión.',
      'error'
    );
    return;
  }
  if (
    !confirm(
      '¿Desactivar el PIN? El corpus y las credenciales de Telegram van a quedar sin cifrar en este dispositivo.'
    )
  ) {
    return;
  }

  setStatus(statusEl, 'Desactivando…', 'info');
  try {
    const sealed = await loadSealedVault();
    const opened = await openDeviceVault(sessionPin, sealed);
    const telegram = opened.telegram || { botToken: '', chatId: '' };

    await savePayloadDirect({ tangos: opened.tangos, salt: opened.salt, tcmp: opened.tcmp || tcmpConfig });
    saveTelegramConfigToLocalStorage(telegram);
    await deleteSealedVault();

    payload = { tangos: opened.tangos, salt: opened.salt, tcmp: opened.tcmp || tcmpConfig };
    sessionPin = null;
    setVaultMode('direct');

    populateTelegramFields();
    setStatus(statusEl, 'PIN desactivado.', 'success');
    updateSecurityPanel();
  } catch (err) {
    setStatus(statusEl, err.message || 'No se pudo desactivar el PIN.', 'error');
  }
}

// ---------- deep link / incoming ciphertext ----------

// consumeDeepLink() lives in core/receive/from-query-param.js.
// resolveIncoming() lives in core/receive/index.js.
// Both are called at the top of init() via resolveIncoming().

/**
 * If a ciphertext arrived via deep link, switch to Descifrar mode and
 * pre-load it into the textarea. Called from enterComposer() once the
 * vault is open and the composer is visible.
 *
 * Fase 7.2: if the vault was already open (frictionless mode, no unlock
 * screen was shown), auto-run descifrarMensaje() immediately so the
 * receiver sees the plaintext in one tap instead of two. If decryption
 * fails (malformed fragment), the existing error handling in
 * handleRunAction() shows a descriptive message — no crash.
 *
 * @param {boolean} autoRun - true when enterComposer() was reached without
 *   going through an unlock screen (vault was already open this session).
 */
function applyDeepLinkIfPending(autoRun = false) {
  if (!pendingDeepLink) return;
  const codigo = pendingDeepLink;
  pendingDeepLink = null;

  setMode('descifrar');
  $('#message-input').value = codigo;

  if (autoRun) {
    // Vault already open — run decryption immediately. handleRunAction()
    // handles both the success path (renders plaintext) and the error
    // path (shows descriptive status message) without any extra code here.
    handleRunAction();
  } else {
    // Vault was just unlocked — surface a hint so the user knows what
    // landed in the field and what to do next.
    setStatus($('#composer-status'), 'Mensaje recibido — tocá Descifrar para leerlo.', 'info');
  }
}

// Module-level variable — set by consumeDeepLink() inside init(), before
// the vault unlock path begins. Keeping it here (rather than inside init's
// closure) lets applyDeepLinkIfPending() and enterComposer() reach it
// without parameters while still being called lazily (not at parse time).
let pendingDeepLink = null;

function enterComposer(autoRunDeepLink = false) {
  syncTCMPFromPayload();
  populateTangoSelect();
  populateTelegramFields();
  populateTCMPFields();
  populateRecipientSelect();
  setMode('cifrar');
  showScreen('app');
  applyDeepLinkIfPending(autoRunDeepLink);
}

async function getSharedFileIfAvailable() {
  // Check if we have a shared file from Web Share Target
  const urlParams = new URLSearchParams(location.search);
  if (!urlParams.get('shared_file_ready')) return null;
  
  try {
    // Open the same IndexedDB the service worker uses
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
            // Clean up the stored file after reading. Wait for the
            // delete transaction to complete before resolving so callers
            // won't race with the DELETE operation.
            const deleteTx = db.transaction(['files'], 'readwrite');
            const deleteStore = deleteTx.objectStore('files');
            deleteStore.delete('latest');

            deleteTx.oncomplete = () => {
              try {
                db.close();
              } catch (e) {}
              resolve({
                text: async () => result.content,
                name: result.filename || 'shared.txt',
              });
            };

            deleteTx.onerror = () => {
              // Best-effort: still resolve with the data even if the
              // delete failed, but close the DB handle.
              try {
                db.close();
              } catch (e) {}
              resolve({
                text: async () => result.content,
                name: result.filename || 'shared.txt',
              });
            };
          } else {
            try {
              db.close();
            } catch (e) {}
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
    console.warn('Error reading shared file:', err);
    return null;
  }
}

async function init() {
  // Handle Web Share Target if this page was opened via sharing a file.
  // When someone shares a .txt file with this app, the service worker
  // stores it in IndexedDB and redirects here with ?shared_file_ready=1
  let sharedFile = null;
  if (location.search.includes('shared_file_ready=1')) {
    sharedFile = await getSharedFileIfAvailable();
    if (sharedFile) {
      console.log('📎 Received shared file:', sharedFile.name);
      // Clean up the URL by removing the shared_file_ready parameter
      const newUrl = new URL(location);
      newUrl.searchParams.delete('shared_file_ready');
      history.replaceState(null, '', newUrl.toString());
    }
  }

  // Read and clear any incoming ciphertext (from ?c= query param or shared
  // file) before any async work, so the URL is clean before vault unlock.
  pendingDeepLink = await resolveIncoming({ loc: location, hist: history, sharedFile });
  $('#unlock-form').addEventListener('submit', handleUnlockSubmit);
  $('#pin-unlock-form').addEventListener('submit', handlePinUnlockSubmit);
  $('#mode-cifrar').addEventListener('click', () => setMode('cifrar'));
  $('#mode-descifrar').addEventListener('click', () => setMode('descifrar'));
  $('#run-action').addEventListener('click', handleRunAction);
  $('#copy-button').addEventListener('click', handleCopy);
  $('#send-button').addEventListener('click', handleSend);

  // "Abrir archivo cifrado" button — visible in Descifrar mode.
  // Triggers the hidden #open-file input so the receiver can open a .txt
  // attachment sent via documentTransport (strategy #2).
  const openFileButton = $('#open-file-button');
  if (openFileButton) {
    openFileButton.addEventListener('click', () => {
      const input = $('#open-file');
      if (input) input.click();
    });
  }

  // File input fallback for receiving ciphertext via shared .txt file
  // (document transport strategy). Works before Web Share Target is wired.
  const openFileInput = $('#open-file');
  if (openFileInput) {
    openFileInput.addEventListener('change', async e => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const codigo = await resolveIncoming({ sharedFile: file });
      // Reset the input so the same file can be opened again if needed.
      openFileInput.value = '';
      if (codigo) {
        pendingDeepLink = codigo;
        applyDeepLinkIfPending(/* autoRun */ vaultMode === 'direct' && !!payload);
      }
    });
  }

  const clearPendingIfEmpty = () => {
    if (!getComposerText().trim() && !$('#attachment-input')?.files?.length) {
      $('#send-row').hidden = true;
      $('#send-row').dataset.cipherText = '';
      $('#output-strip').innerHTML = '';
      pendingTCMP = null;
      setStatus($('#composer-status'), '', 'info');
    }
  };
  $('#message-editor').addEventListener('input', clearPendingIfEmpty);
  $('#attachment-input').addEventListener('change', clearPendingIfEmpty);
  document.querySelectorAll('.rich-toolbar [data-cmd]').forEach(button => {
    button.addEventListener('click', () => {
      $('#message-editor').focus();
      document.execCommand(button.dataset.cmd, false);
    });
  });
  initSettings();
  initTCMPSettings();
  initSecuritySettings();
  initMaintenance();

  vaultMode = getVaultMode();

  // Check if the server has a newer bundle than what's stored locally.
  // generated_at lives in the bundle's plaintext metadata (outside AES-GCM),
  // so we can compare without CLAVE_DESPLIEGUE. If the server bundle is
  // newer, wipe local storage and force re-unlock so the user gets the
  // updated corpus (e.g. a new tango was added).
  await checkBundleFreshness();

  // Fire-and-forget: keeps the displayed corpus date up to date in settings.
  refreshBundleGeneratedAt();

  if (vaultMode === 'pin' && (await hasSealedVault())) {
    showScreen('pin-unlock');
  } else if (await hasPayloadDirect()) {
    payload = await loadPayloadDirect();
    enterComposer(true); // vault was already open — auto-run deep link if present
    await refreshTCMPRoster();
    startTCMPInboxPolling();
  } else {
    // Covers true first run, and the edge case where localStorage says
    // 'pin' but the sealed IndexedDB record is missing (e.g. the user
    // cleared site data by hand) -- fall back to asking for
    // CLAVE_DESPLIEGUE again instead of showing a PIN prompt that can
    // never succeed.
    setVaultMode('direct');
    showScreen('unlock');
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('./service-worker.js')
      .then(registration => {
        // Browsers only check service-worker.js for changes in the
        // background every ~24h by default. Forcing a check on every
        // load means a forgotten CACHE_VERSION bump still gets
        // noticed the next time the user opens the app, not up to a
        // day later.
        registration.update().catch(() => {});
      })
      .catch(() => {
        // Offline install just won't be available this session; the app
        // still works online without it.
      });

    // When a new SW takes control (skipWaiting fired), reload the page so
    // the new shell + purged caches take effect immediately — without this,
    // the old in-memory JS keeps running even though the new SW is active.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    });
  }
}

init();

