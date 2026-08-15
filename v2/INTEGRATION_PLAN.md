# Integración con el proyecto actual — ✅ COMPLETADO

El proyecto existente ya separaba `pwa/core/transport/` y `pwa/core/receive/`, y disponía de `server-bridge.js`; la implementación aprovechó esas costuras en vez de rehacer `app.js`.

## ✅ Paso 1 — COMPLETO
Código de `v2/client/*` integrado en `pwa/core/tcmp/protocol/` con toda la jerarquía: `crypto/`, `tango/`, `messages/`, `media/`, `transport/`. El directorio `v2/client/` fue eliminado — la copia canónica es `pwa/core/tcmp/`.

## ✅ Paso 2 — COMPLETO
`pwa/cipherEngine.js` se mantiene como compatibilidad histórica. No se mezcló su XOR fallback con TCMP.

## ✅ Paso 3 — COMPLETO
`pwa/core/tcmp/protocol/transport/cloudflare.js` — transporte HTTP al Worker (fuente originada en `v2/`, copia canónica en `pwa/core/tcmp/`).

## ✅ Paso 4 — COMPLETO
`handleSend()` construye un `MessageEnvelope` y lo envía al Worker via `sendText()` / `sendAttachment()` en `pwa/core/tcmp/index.js`.

## ✅ Paso 5 — COMPLETO
Inbox local en `pollInbox()` consulta `/v1/inbox/<deviceId>` y elimina un mensaje del servidor solo después de confirmar que el descifrado y la persistencia local fueron correctos.

## ✅ Paso 6 — COMPLETO
`RichTextDocument` integrado en el compositor vía `pwa/core/tcmp/richtext-dom.js`. El documento JSON completo se cifra como bytes UTF-8; no se reconstruye HTML en el servidor.

## ✅ Paso 7 — COMPLETO
Attachments implementados en `pwa/core/tcmp/protocol/media/attachments.js`. El archivo original se lee como `ArrayBuffer`, se hashea, se cifra por chunks y se sube a R2. D1 recibe solamente metadata cifrada/identificadores.

## ✅ Paso 8 — COMPLETO
APK TWA se mantiene sin cambios. El share target no se reintrodujo (guardia `ALLOW_SHARE_TARGET` activa, ver `TO_FIX.md` M-5).

## ⏳ Paso 9 — PENDIENTE
Telegram sigue activo como fallback. Eliminar del flujo principal solo después de completar pruebas A→Cloudflare→B en Android y Linux.
