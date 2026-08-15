# Especificación Técnica y Pasos de Implementación: Aplicación de Cifrado por Tangos e Integración con Telegram

## 1. Visión General del Proyecto
Esta especificación describe la arquitectura e implementación de una aplicación PWA (Progressive Web App) orientada a la transmisión segura de mensajes y artículos de texto plano mediante un canal de transporte no seguro (Telegram).

### Principios Fundamentales
* **Zero-Trust sobre el Canal de Transporte:** Telegram funciona estrictamente como una tubería ciega. Solo transita texto cifrado mediante coordenadas numéricas (`50-V09P01-~20-V09P02...`).
* **Zero-Knowledge en la red y en el repo público:** La base de datos de tangos (`tangos.json`) y el valor de `SALT` permanecen resguardados exclusivamente en un **repositorio privado de GitHub**; el repo público y el canal de Telegram nunca ven esos datos en texto plano. **A nivel del dispositivo esto depende del modo elegido**: en el modo sin fricción (por defecto), el corpus descifrado queda en IndexedDB en texto plano — cualquiera con acceso al almacenamiento del dispositivo puede leerlo. Activando el PIN de dispositivo (Ajustes > "Seguridad del dispositivo") ese corpus, junto con las credenciales de Telegram, queda cifrado en reposo bajo AES-256-GCM derivado del PIN. Ver `TO_FIX.md` P3-2/P3-3.
* **Infraestructura principal: GitHub Pages + Cloudflare Workers:** La PWA se sirve desde GitHub Pages. El transporte de mensajes usa Cloudflare (D1 para mensajes, R2 para adjuntos). Telegram se mantiene como canal de compatibilidad legacy.
* **Cero Fricción para el Usuario:** Tu cliente ingresa la Clave de Despliegue por única vez al instalar la PWA en su celular. A partir de allí, el acceso es instantáneo (abrir, redactar y enviar).

---

## 2. Arquitectura de Despliegue de Doble Repositorio

Para alojar la PWA gratis en GitHub Pages sin exponer el archivo `tangos.json` ni el `SALT` en texto plano al público, se utiliza la siguiente arquitectura:

```
[ REPO 1: PRIVADO ]
(Contiene: tangos.json en texto plano, SALT, motor Python, código fuente)
       │
       │ (git push)
       ▼
[ GITHUB ACTION (Gratuita) ]
1. Toma tangos.json + SALT.
2. Cifra el paquete usando AES-256-GCM con una CLAVE_DESPLIEGUE secreta (definida en Repo Secrets).
3. Inyecta el paquete cifrado en el archivo PWA estático.
       │
       ▼
[ REPO 2: PÚBLICO (GitHub Pages) ]
(Contiene: PWA estática con el blob cifrado e indecodificable para terceros)
       │
       ▼
[ PWA INSTALADA EN CELULAR ]
1. Primera vez: Pide la CLAVE_DESPLIEGUE, descifra la base y la guarda en IndexedDB local.
2. Día a día: Abre directo, cifra mensajes y los envía a Telegram sin pedir contraseñas.
```

---

## 3. Especificación Criptográfica y Datos

### 3.1 Estructura de `tangos.json` (En Repo Privado)
```json
{
  "3": {
    "titulo": "Cambalache",
    "versos": [
      ["Que", "el", "mundo", "fue", "y", "será", "una", "porquería", "ya", "lo", "sé"],
      ["En", "el", "quinientos", "diez", "y", "en", "el", "dos", "mil", "también"],
      ["que", "siempre", "ha", "habido", "chorros", "maquiavelos", "y", "estafaos"],
      ["contentos", "y", "amargaos", "valores", "y", "doble", "doble", "a"],
      ["pero", "que", "el", "siglo", "veinte", "es", "un", "despliegue"],
      ["de", "maldad", "insolente", "ya", "no", "hay", "quien", "lo", "niegue"],
      ["vivimos", "revolcaos", "en", "un", "merengue"],
      ["y", "en", "el", "mismo", "lodo", "todos", "manoseaos"],
      { "padding": true, "palabras": ["mañana", "subir", "este", "artículo", "que", "te", "di", "ayer"] },
      { "padding": true, "palabras": ["hoy", "publicar", "el", "nuevo", "documento", "del", "cliente"] }
    ]
  }
}
```
> Los versos con `"padding": true` son vocabulario técnico agregado para ampliar cobertura. No forman parte de la letra original.

### 3.2 Cifrado por Coordenadas
* **Enmascaramiento:** `clave_enmascarada = id_tango + SALT` (ej: `3 + 47 = 50`).
* **Formato de Token:** `V[verso]P[palabra]` con flag de capitalización opcional (ej: `V09P01`, `V09P01^C`, `V09P01^U`).
* **Puntuación y espacios:** cada carácter no-letra se codifica como `~hex` (ej: espacio = `~20`, coma = `~2c`).
* **Dígitos:** corridas de dígitos consecutivos se codifican como un único token `#hex`.
* **Fallback:** palabras fuera del corpus se cifran con XOR SALT en hex, marcadas con `#` (ej: `#5a6b7c`, `#5a6b7c^C`).
* **Round-trip lossless:** el texto descifrado es idéntico al original — mayúsculas, puntuación y espaciado exactos.

---

## 4. Guía de Implementación Paso a Paso

### Paso 1: Configuración de Telegram
1. Crear el bot con `@BotFather` en Telegram y guardar el `TELEGRAM_BOT_TOKEN`.
2. Iniciar chat con el bot y obtener el `TELEGRAM_CHAT_ID` vía:
   `https://api.telegram.org/bot<TU_BOT_TOKEN>/getUpdates`

---

### Paso 2: Motor de Cifrado en JS (`cipherEngine.js`)

El motor actual implementa tokenización lossless (capitalización + puntuación + dígitos) y soporte de versos `padding`. Ver `cipherEngine.js` en el repo para la implementación completa.

Funciones exportadas:
```javascript
// Cifra un mensaje preservando capitalización, puntuación y espaciado exactos.
// salt: número (ej: 47). baseTangos: objeto parseado de tangos.json.
// NOTA: async porque el fallback deriva su keystream con SubtleCrypto (PBKDF2).
export async function cifrarMensaje(idTango, mensaje, baseTangos, salt)

// Descifra — el resultado es idéntico al mensaje original. También async
// por el mismo motivo (SubtleCrypto.deriveBits en el fallback).
export async function descifrarMensaje(codigoCifrado, baseTangos, salt)
```

Características clave:
- Tokenización Unicode con `/\p{L}+/gu` — soporta `ñ`, tildes y cualquier letra Unicode.
- Tokens de caso: `^C` (primera mayúscula), `^U` (todo mayúsculas).
- Tokens de puntuación/espacios: `~hex` (ej: `~20` = espacio, `~2c` = coma).
- Dígitos: corrida agrupada como un único `#hex`.
- Versos `padding`: soporta formato `{padding: true, palabras: [...]}` además de arrays planos.

---

### Paso 3: Script de Cifrado para Deploy (`scripts/build_encrypted_bundle.py`)

> **Repo privado.** Este script vive en `scripts/build_encrypted_bundle.py` dentro del repo privado (`tango_corpus_private`). Hay una copia de referencia en el repo público en `scripts/ci/build_encrypted_bundle.py` usada por los tests locales — pero **el que corre en producción CI es el del repo privado**. Si editás la copia pública, actualizá también la privada.

```
python3 scripts/build_encrypted_bundle.py \
  --tangos tangos.json \
  --salt $CIFRADO_SALT \
  --out pwa/encrypted-bundle.json
```

Detalles criptográficos:
- **Algoritmo:** AES-256-GCM
- **KDF:** PBKDF2-HMAC-SHA256, 600 000 iteraciones, nonce y KDF salt aleatorios por cada build
- **Output:** JSON con campos `kdf_salt_b64`, `nonce_b64`, `ciphertext_b64`, `aad`, `kdf_iterations`
- **Verificación:** `scripts/decrypt_bundle_cli.py` como smoke-test en la misma Action

---

### Paso 4: Workflow de GitHub Actions (`.github/workflows/build-encrypted-bundle.yml`)

El workflow del repo **privado** tiene dos jobs:

**Job `build`** — genera el bundle y lo sube como artifact:
```yaml
on:
  push:
    branches: [main]
    paths:
      - "tangos.json"
      - "scripts/build_encrypted_bundle.py"

jobs:
  build:
    steps:
      - uses: actions/checkout@{SHA_PINNEADO}
      - run: pip install cryptography==46.0.6
      - name: Required secrets guard   # falla explícitamente si falta CLAVE_DESPLIEGUE, CIFRADO_SALT o PUBLIC_REPO_DEPLOY_TOKEN
        env:
          HAS_CLAVE: ${{ secrets.CLAVE_DESPLIEGUE != '' }}
          HAS_SALT:  ${{ secrets.CIFRADO_SALT != '' }}
          HAS_PAT:   ${{ secrets.PUBLIC_REPO_DEPLOY_TOKEN != '' }}
        run: |
          test "$HAS_CLAVE" = true || { echo "❌ CLAVE_DESPLIEGUE missing"; exit 1; }
          test "$HAS_SALT"  = true || { echo "❌ CIFRADO_SALT missing"; exit 1; }
          test "$HAS_PAT"   = true || { echo "❌ PUBLIC_REPO_DEPLOY_TOKEN missing"; exit 1; }
      - run: |
          python3 scripts/build_encrypted_bundle.py \
            --tangos tangos.json \
            --salt ${{ secrets.CIFRADO_SALT }} \
            --out pwa/encrypted-bundle.json
        env:
          CLAVE_DESPLIEGUE: ${{ secrets.CLAVE_DESPLIEGUE }}
      - run: python3 scripts/decrypt_bundle_cli.py pwa/encrypted-bundle.json
        env:
          CLAVE_DESPLIEGUE: ${{ secrets.CLAVE_DESPLIEGUE }}
      - uses: actions/upload-artifact@{SHA_PINNEADO}
        with:
          name: encrypted-bundle
          path: pwa/encrypted-bundle.json
```

**Job `deploy-to-public-repo`** — hace checkout del repo público, compara el SHA del bundle, y solo commitea + pushea si cambió (evita commits no-op):
```yaml
  deploy-to-public-repo:
    needs: build
    if: success()
    steps:
      - uses: actions/checkout@{SHA_PINNEADO}
        with:
          repository: misbusquedaspersonales-cyber/tango_cipher_bot_public
          ref: main
          token: ${{ secrets.PUBLIC_REPO_DEPLOY_TOKEN }}
          fetch-depth: 0
      - uses: actions/download-artifact@{SHA_PINNEADO}
        with:
          name: encrypted-bundle
          path: new-bundle
      - name: Solo commitear si el bundle cambió
        run: |
          NEW_SHA=$(sha256sum new-bundle/encrypted-bundle.json | cut -c1-12)
          OLD_SHA=$(sha256sum public-repo/pwa/encrypted-bundle.json 2>/dev/null | cut -c1-12 || echo "(missing)")
          [ "$OLD_SHA" = "$NEW_SHA" ] && echo "📭 Sin cambios, skip." && exit 0
          cp new-bundle/encrypted-bundle.json pwa/encrypted-bundle.json
          git add pwa/encrypted-bundle.json
          git commit -m "deploy(encrypted-bundle): $NEW_SHA"
          git push origin main
```

> `CIFRADO_SALT` y `CLAVE_DESPLIEGUE` son secretos del **repo privado**. `PUBLIC_REPO_DEPLOY_TOKEN` también va en el repo privado — es un fine-grained PAT con `Contents: write` restringido únicamente al repo público.

---

### Paso 5: Interfaz Web PWA y Almacenamiento Local (`app.js` + `secure-vault.js`)

La gestión de credenciales en el browser está implementada en `secure-vault.js`. El flujo por defecto es sin fricción:

**Primera apertura (única vez):**
1. `hasPayloadDirect()` → vacío → solicitar `CLAVE_DESPLIEGUE` al usuario.
2. Descargar `pwa/encrypted-bundle.json`.
3. `unlockDeployBundle(claveDespliegue, bundle)` → devuelve `{ tangos, salt }`.
4. `savePayloadDirect(payload)` → guarda en IndexedDB.

**Aperturas posteriores (uso diario):**
1. `loadPayloadDirect()` → carga `{ tangos, salt }` desde IndexedDB.
2. **Flujo principal (TCMP/Cloudflare):** `sendText()` / `sendAttachment()` desde `pwa/core/tcmp/index.js` cifran y envían al Worker. La recepción ocurre via `pollInbox()`. Ver `pwa/core/tcmp/` para la implementación completa.
3. **Flujo legacy (Telegram):** cifrar con `cifrarMensaje()` (recordar `await` — es async) y enviar via `sendCiphertext()`:

```javascript
// sendCiphertext() está en pwa/core/transport/index.js.
// Elige automáticamente la estrategia correcta:
//   - Mensajes cortos (deep-link URL ≤ 2048 bytes): chunkedTextTransport
//     → sendMessage con botón "Descifrar →" que pre-carga el campo.
//   - Mensajes largos: documentTransport
//     → sendDocument (archivo .txt adjunto), receptor abre con la app.

import { sendCiphertext } from './core/transport/index.js';
import { resolveIncoming } from './core/receive/index.js';

// Enviar (legacy Telegram):
const result = await sendCiphertext(codigo, {
    botToken, chatId,
    origin: location.origin,
    pathname: location.pathname,
    search: location.search,
});

// Recibir (al abrir la app desde el botón "Descifrar →"):
const pendingCipher = await resolveIncoming({ loc: location, hist: history });
// pendingCipher es el ciphertext string, o null si no había ninguno pendiente.
```

**⚠️ Advertencia criptográfica:** La capa de sesión TCMP actual usa P-256 ECDH + ECDSA + HKDF + AES-256-GCM. Es una base funcional de migración — no debe presentarse como equivalente a un protocolo Double Ratchet auditado. La interfaz está aislada en `pwa/core/tcmp/protocol/crypto/message.js` para permitir sustitución futura.

> Ver `pwa/core/tcmp/` para las implementaciones TCMP. Ver `pwa/core/transport/` para las estrategias legacy de envío. Ver `pwa/secure-vault.js` para `sealForDevice`/`openDeviceVault` (PIN-gated, opt-in).

