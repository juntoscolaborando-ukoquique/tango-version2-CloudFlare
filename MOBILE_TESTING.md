# MOBILE_TESTING.md — Probar la PWA como app móvil de verdad

> NOTE: This file previously included APK build and install steps. The canonical
> APK build & release procedure has been consolidated into [APK_BUILD.md](APK_BUILD.md).
> Use that file for builds and artifact verification; this document remains focused
> on mobile testing and runtime verification.


## ⚠️ **IMPORTANTE: Web Share Target Compatibilidad**

**Nota crítica**: Se descubrió que las APK con Web Share Target (`shareTarget` en twa-manifest.json) causan fallos de instalación en ciertos dispositivos Android. 

**APK recomendado para testing**: `tango-cifrado-NO-SHARE-TARGET.apk`
- ✅ Instalación verificada exitosa
- ❌ **NO incluye** Web Share Target (sin menú "Compartir" nativo)  
- ✅ Funcionalidad completa: cifrado, descifrado, envío Telegram
- ✅ Fallback manual: `<input type="file">` funciona normalmente

**Limitación conocida**: Los usuarios deben usar flujo manual para recibir archivos .txt:
1. Descargar archivo .txt desde Telegram
2. Abrir Tango Cifrado APK  
3. Tocar botón "📁 Seleccionar archivo"
4. Navegar a Descargas → seleccionar archivo .txt
5. La app descifra automáticamente

**Para desarrollo futuro**: Investigar compatibilidad Web Share Target + TWA + versiones Android específicas.

---

Esta guía cubre cómo llevar la PWA de "archivos en una carpeta" a "app
instalada en tu celular". La **primera sección** explica cómo instalar; la
**segunda sección** (checklist) es específica para cada release y debe
re-recorrerse *antes de marcar un deploy como OK*.

> ⚠️ **El APK real y "instalar la PWA desde Chrome" son dos binarios
> distintos.** El APK (TWA, `tango-cifrado-apk/`) es el que se distribuye
> a usuarios reales vía sideload (ver `PASOS_APK.md`) y tiene su propio
> `AndroidManifest.xml` generado por Bubblewrap a partir de
> `twa-manifest.json` — features nativas como el intent-filter de
> "Compartir con esta app" (Web Share Target) dependen de ESE archivo, no
> del `manifest.json` de la PWA web. Un cambio en `pwa/manifest.json` no
> llega automáticamente al APK: hace falta rebuildear con
> `build-apk.sh` (que ahora corre `sync-share-target.sh` en cada build,
> ver más abajo) y reinstalar. Por eso el checklist de regresión de cada
> release debe correrse sobre **el .apk firmado real**, no solo sobre la
> PWA instalada desde Chrome — este último camino queda documentado como
> **alternativa** para cuando no querés/necesitás generar el ejecutable.

---

## Camino recomendado: instalar el APK real (sideload)

Este es el camino que van a usar tus destinatarios reales — es el único
que ejercita el `AndroidManifest.xml` generado por Bubblewrap (intent
filters, Web Share Target, ícono/nombre nativos, ausencia total de barra
de Chrome). Si vas a validar un release antes de repartir el APK, probalo
por acá.

1. Compilar el APK (o descargarlo del último GitHub Release si ya corrió el CI):
   ```bash
   cd tango-cifrado-apk
   ../scripts/apk/build-apk.sh
   ```
   Esto además sincroniza automáticamente cualquier cambio en
   `pwa/manifest.json` (incluyendo `share_target`) hacia
   `twa-manifest.json` antes de compilar — ver

## 🔍 Verificaciones post-build obligatorias

Una vez que `build-apk.sh` termine sin errores, **no confíes automáticamente en que el `.apk` resultante esté bien** — hubo casos donde el script reportaba éxito pero la app tenía configuraciones incorrectas por bugs de sincronización (ver `TO_FIX.md` M-4 y M-5). Corré estas verificaciones **antes** de distribuir:

### ✅ Verificación completa del APK generado

No confíes solo en el mensaje de éxito del script — confirmá el artefacto real:

```bash
python3 -c "
from pyaxmlparser import APK
apk = APK('dist/apk/app-release-signed.apk')
print('Package:', apk.package)
print('versionCode/versionName:', apk.version_code, '/', apk.version_name)
print('minSdk/targetSdk:', apk.get_min_sdk_version(), '/', apk.get_target_sdk_version())
print('Firmado v1/v2/v3:', apk.is_signed_v1(), apk.is_signed_v2(), apk.is_signed_v3())
print('Permite SEND intent:', 'android.intent.action.SEND' in str(apk.get_android_manifest_xml()))
"
```

> 💡 **Si no tenés pyaxmlparser instalado:** `pip install pyaxmlparser --break-system-packages`

**Resultado esperado:**
| Campo | Valor esperado |
|---|---|
| `Package` | `com.tangocifrado.app` |
| `versionCode` | Número mayor al build anterior |
| `versionName` | Formato "X.Y.Z" consistente con `twa-manifest.json` |
| `minSdk` / `targetSdk` | Consistentes entre sí, **no** strings vacíos `""` (ver TO_FIX.md M-4) |
| Firmado v1/v2/v3 | `True`, `True`, `True` |
| **Permite SEND intent** | **`False`** — Si sale `True`, el intent-filter problemático de Web Share Target volvió; **NO distribuyas este APK** |

### ✅ Archivo existe con tamaño correcto

```bash
ls -la dist/apk/app-release-signed.apk
```

**Resultado esperado:** archivo de ~1-2 MB con timestamp reciente.

---
   `scripts/apk/sync-share-target.sh`.

## 🚚 Transferencia segura del APK al dispositivo

**⚠️ CRÍTICO:** **NO uses email (Outlook, Gmail)** — confirmado que corrompe el archivo en tránsito. Usá uno de estos métodos verificados:

### ✅ Métodos seguros confirmados
- **Telegram** (a vos mismo, "Mensajes guardados")
- **Google Drive / Dropbox** → descargar desde el navegador del teléfono
- **USB directo** (`adb push`, o cable + copiar/pegar)
- **WeTransfer, ShareIt** u otros servicios de transferencia directa

### ✅ Verificación de integridad obligatoria

Después de transferir, **siempre verificá que el archivo llegó intacto** comparando hashes:

**En la PC (antes de enviar):**
```bash
sha256sum dist/apk/app-release-signed.apk
```

**En el teléfono (después de recibir):**
```bash
adb shell sha256sum /sdcard/Download/app-release-signed.apk
```

**Los hashes DEBEN coincidir exactamente.** Si no coinciden:
- ❌ El archivo se corrompió en el transporte
- 🔁 Probá con otro método de transferencia
- ⚠️ **NO instales un APK con hash incorrecto**

---

2. Pasar `dist/apk/app-release-signed.apk` al teléfono usando uno de los métodos seguros de arriba.

## 🧹 Instalación limpia obligatoria

**⚠️ ANTES de instalar: desinstalar completamente cualquier versión previa** de "Tango Cifrado" si ya la tenías instalada. Esto evita dos problemas distintos:

### ✅ Por qué desinstalar primero
- **Conflicto de firma:** Si en algún momento se usó otra keystore, Android muestra "There was a problem parsing the package" en lugar del mensaje de conflicto más claro
- **Intent-filters obsoletos:** Cambios nativos como Web Share Target no se actualizan sobre instalación existente, a diferencia del contenido PWA
- **Configuración limpia:** Evita retener configuraciones inconsistentes de builds anteriores

### ✅ Cómo desinstalar completamente
1. **Ajustes** → **Aplicaciones** → buscar "Tango Cifrado" → **Desinstalar**
2. O: mantener presionado el ícono de la app → **Desinstalar** 
3. Confirmar que desaparece de la pantalla de inicio

---

3. Abrir el archivo → Android pide habilitar "Fuentes desconocidas" → habilitar.
4. Instalar → abrir.
5. **Si ya tenías una versión previa instalada**, desinstalala primero o instalá encima (mismo `packageId` + misma keystore = update válido). Cambios nativos como Web Share Target **no llegan solos** — a diferencia del contenido de la PWA (`app.js`, etc.), que sí se actualiza solo porque se sirve desde GitHub Pages.

## Alternativa — sin generar el APK: instalar como PWA desde Chrome

Útil para iterar rápido en desarrollo, o si preferís no generar el
ejecutable Android todavía. **No sustituye** al checklist sobre el APK
real antes de un release — ver la advertencia arriba: algunas features
nativas (Web Share Target entre ellas) solo se validan de verdad sobre el
`.apk` firmado.

### Camino rápido (Android + Chrome, local dev)

1. En la carpeta del proyecto, levantar un servidor local:
   ```bash
   python3 -m http.server 8000
   ```
2. Conectar el celular por USB y habilitar Depuración USB (en Opciones de desarrollador).
3. En Chrome de escritorio, abrir `chrome://inspect#devices`.
4. Añadir port forwarding: `8000` -> `localhost:8000`.
5. Abrir `http://localhost:8000/pwa/index.html` desde el navegador del celular.
6. Instalar la app desde el navegador y probarla como aplicación instalada.

### Camino de producción (iPhone / Android real, HTTPS)

Para una experiencia real de instalación, la app debe servirse sobre HTTPS real — por ejemplo GitHub Pages:
```
URL corta (raíz):    https://misbusquedaspersonales-cyber.github.io/tango_cipher_bot_public/
URL corta (go.html): https://misbusquedaspersonales-cyber.github.io/tango_cipher_bot_public/go.html
URL larga (manual):  https://misbusquedaspersonales-cyber.github.io/tango_cipher_bot_public/pwa/index.html
```
En iPhone Safari: Compartir → Agregar a pantalla de inicio. En Android Chrome: ⋮ → Instalar app.

---

## ✅ Checklist de regresión — Release 2026-07-31 (caché + short URLs)

Este checklist **no es genérico**: los 7 puntos ejercitan específicamente los cambios del parche caché del 2026-07-31 (service worker rewrite, CACHE_VERSION v5→v10, fallback offline distinguible X-Tango-Offline, redirects de raíz). Si algo falla acá, el deploy no pasa.

### 0. Pre-requisito: los redirects de raíz están pusheados

Los archivos de entrada corta **no deben estar untracked** en el repo público (si lo están, las URLs cortas dan 404 en GH Pages). Verificá antes de deployar:

```bash
git status index.html go.html pwa/go.html pwa/.nojekyll .nojekyll
# Todos deben figurar como tracked (no "Untracked files").
# Si faltan:
git add index.html go.html pwa/go.html pwa/.nojekyll .nojekyll
git commit -m "feat: root redirects for short GitHub Pages URLs"
git push origin main
```

### 1. Short URL → redirect instantáneo (raíz + go.html)

En Chrome mobile **limpio** (cerrar tabs previos, sin caché del sitio):
- Ir a la URL corta de raíz: `https://misbusquedaspersonales-cyber.github.io/tango_cipher_bot_public/`
- Esperar ≤ 1s → debe redirigir automáticamente a `/pwa/index.html`
- Repetir con `/go.html` → mismo comportamiento
- **Si da 404**: el paso 0 falló (archivos no pusheados) o GH Pages aún no construyó. Esperar 30s y hard-refresh.

### 2. Instalación standalone

Desde `/pwa/index.html` en Chrome mobile:
- ⋮ (menú esquina superior derecha) → **Instalar app** → confirmar
- Cerrar Chrome, abrir la app desde el ícono nuevo en Home Screen
- Verificar: **sin barra de direcciones / sin browser chrome** (solo barra de estado Android). Si aparece la barra de URL: `manifest.json` tiene `display: standalone` correcto? SW scope OK? `index.html` meta tag `apple-mobile-web-app-capable` faltante?

### 3. First-run unlock + round-trip real de tangos

Aplicación recién instalada (sin corpus cacheado, sin localStorage de runs previos):
- Ingresar `CLAVE_DESPLIEGUE` exacta
- Esperar mensaje `"Descargando paquete cifrado…"` → `"Descifrando…"` → entra al compositor sin error
- Probar **cifrar** un texto que ejercite acentos, ñ, puntuación, dígitos, por ejemplo:
  > *"¡Mañana por la tarde iré al boliche de la calle 50 con Juan y María!"*
- Seleccionar un tango real, apretar Cifrar → debe generar coordenadas con chips (incluyendo fallback `#hex` para "boliche" si no está en corpus)
- Copiar el texto cifrado, togglear a Descifrar, pegar → debe reconstruir el **mismo texto exacto** (con ñ, !, ¡, 50, mayúsculas M/J/M). Si alguna letra acentuada se corrompe: Unicode NFKC desalineado (P1-5 falló en esta plataforma).

### 4. Fallback offline / timeout — la parte que realmente cambió

Este es el core del parche caché. Son DOS escenarios distintos (ambos deben pasar):

#### Escenario A: Bundle YA cacheado (uso cotidiano offline)

- App abierta y desbloqueada una vez (ya cargó el bundle con éxito)
- Poner teléfono en **Modo Avión** (wifi + datos off, sin cobertura)
- **Force-close total** de la app (Overview → swipe up / X) — NO solo cambiar de app
- Reabrir desde el ícono Home
- Resultado esperado: **entra directo al compositor sin delay ni error** (carga el bundle desde BUNDLE_CACHE del service worker). No debe pedir CLAVE_DESPLIEGUE de vuelta. Si cuelga cargando: el timeout del SW o el fallback `caches.match()` no están funcionales.

#### Escenario B: Bundle NUNCA cacheado (fresh install + offline)

- Borrar datos / desinstalar completamente la app (para quitar `BUNDLE_CACHE` + IndexedDB + localStorage)
- Seguir en Modo Avión (sin red de ningún tipo)
- Abrir la app, ingresar CLAVE_DESPLIEGUE, submit
- Resultado esperado: después de ~5s (NETWORK_TIMEOUT_MS), aparece el mensaje nuevo en español, NO el `HTTP 0` críptico:
  > *"Sin conexión y no hay una copia guardada del paquete cifrado. Conectate a internet y probá de nuevo."*
- **Si en cambio aparece "No se pudo descargar ./encrypted-bundle.json (0)"** — el header `X-Tango-Offline: 1` no está llegando al catch de `app.js` (revisar que el SW devuelve Response sintético y no el `Response.error()` opaco viejo).
- **Si se cuelga más de 15s esperando** — `NETWORK_TIMEOUT_MS=5000` del race del SW no está disparando el reject.

#### Volver online

- Apagar Modo Avión, esperar 5s que levante señal
- Force-close, reabrir, submit CLAVE_DESPLIEGUE → debe descargar y desbloquear normalmente.
- En Settings debe aparecer la fecha de `Corpus actualizado el DD/MM/AAAA` (confirma `refreshBundleGeneratedAt()` también anduvo con su `cache: "no-cache"`).

### 5. Service Worker update + purga de cachés viejas

Esto valida que el `CACHE_VERSION` bump v5→v8 realmente dispara la purga de viejas instalaciones. Necesitás **una instalación previa de versión vieja** (sin el parche caché). Si no la tenés: simularla usando la URL `/pwa/service-worker.js?v=viejo` en desktop antes de este test, o editar `CACHE_VERSION` a v6 en local y hacer un deploy temporal a una subruta.

Procedimiento real sobre instalación vieja ya existente en el teléfono:
1. Conectar USB, abrir `chrome://inspect#devices` en Chrome desktop, seleccionar el WebView de la PWA.
2. Abrir la app, esperar ~5s (Chrome checkea updates de SW en cada navigation).
3. **Force-close completo**. Reabrir 1 vez. (Esto es: primera apertura → update check encuentra nuevo SW, `install` + `skipWaiting`; cierre → segunda apertura → `activate` corre y purga.)
4. En DevTools desktop, pestaña Application → Service Workers:
   - ✅ El SW `tango-cifrado-v10` figura **activated & running** (no "waiting")
   - ✅ Storage → Caches: solo deberían aparecer `tango-cifrado-v10-shell`, `tango-cifrado-v10-bundle`, `tango-cifrado-v10-runtime`
   - ❌ Si aún aparece `tango-cifrado-v5-*` o `v6-*` → `clients.claim()` o `skipWaiting()` no se ejecutó. Revisar Consola por mensajes `[SW activate] purged N old caches.` (lo agrega el install/activate handlers).

### 6. Envío Telegram real desde datos móviles

Importante: usar **mobile data**, NO wifi (testea que el bot de Telegram es alcanzable desde IPs reales).
- Settings → Ajustes: pegar `botToken` y `chatId` reales. Guardar → debe decir "Guardado." éxito.
- Volver al compositor, cifrar un mensaje real corto (ej: *"Hola, prueba desde datos móviles"*).
- Apretar **Enviar a Telegram** → status debe decir "Enviando a Telegram…" → "Enviado."
- Abrir el chat del bot en Telegram mobile: debe figurar el mensaje cifrado.
- Si falla con 400 y el texto mide >4096 chars: el chequeo upfront `TELEGRAM_MAX_LEN` en `app.js:143` está OK; eso es esperado para mensajes largos. Si falla sin mensaje descriptivo y el texto es corto: `resp.json()` de Telegram API no está parseando el `description` (revisar `enviarATelegram` catch del status).

### 7. Si algo falla: cómo diagnosticar rápido

Usar **`chrome://inspect#devices`** (desktop) con el teléfono por USB → DevTools en vivo contra el WebView de la PWA. **Consola** va a tener logs exactos por cada handler del SW rewrite:

| Log prefix | Qué mirar si falla |
|---|---|
| `[SW install] precache N/12 shell files OK.` | Si `ok < 12`: algún SHELL_FILES devolvió no-OK en precache inicial. Mirar Network tab por cuál dio 404/503. |
| `[SW install] algunos shell fallaron:` | El array de URLs que fallaron. |
| `[SW activate] purged N old caches.` | Si `N = 0` en una actualización desde v5/v6: el `CACHE_VERSION` no cambió o no corre activate. |
| `[SW fetch] bundle network failed, fallback to cache.` + `err.message` | Si esto aparece y luego `X-Tango-Offline` no: `caches.match()` sí encontró una copia, pero si no se cargó la app, revisar IndexedDB del payload (secure-vault.js). |

**Network tab**, filtro por `encrypted-bundle.json`: en el Response Headers debería aparecer `X-Tango-Offline: 1` si el scenario 4B está andando; sin ese header exacto, el mensaje español de error en app.js no se dispara.

---

## Verificaciones base (cualquier release, además del checklist específico)

Además del checklist por release, confirmar siempre:
- Standalone sin barra URL ✅
- Fuentes cargan (IBM Plex Mono en chips — no fallback serif sans) ✅
- Ícono PWA en home screen (el ícono marrón/brass, no el default Chrome) ✅

---

## ✅ Checklist de regresión — Fase 7.1 (deep link / recepción de mensajes)

Estos dos puntos no son cubiertos por tests automatizados y deben verificarse manualmente en dispositivo real antes de considerar Fase 7.1 completa.

### 7.1-A. iOS Telegram → botón inline abre la PWA instalada (no Safari)

**Contexto:** iOS maneja la apertura de URLs desde apps externas (Telegram) de forma inconsistente dependiendo de la versión y de cómo está registrada la PWA. El riesgo es que el botón "Descifrar →" abra Safari en lugar del ícono instalado en Home Screen, forzando al receptor a repetir el desbloqueo y perdiendo el contexto.

**Setup:**
- Dispositivo iOS con la PWA instalada en Home Screen (Compartir → Agregar a pantalla de inicio desde Safari).
- Dispositivo emisor con la app desbloqueada y Telegram configurado.

**Pasos:**
1. En el emisor: cifrar un mensaje real, apretar Enviar a Telegram. Confirmar "Enviado."
2. En el receptor iOS: ver llegar la notificación de Telegram.
3. Tocar la notificación para abrir el chat, luego tocar el botón **Descifrar →**.

**Resultado esperado:**
- Se abre la PWA instalada en modo standalone (sin barra de Safari, sin browser chrome).
- El campo Descifrar ya tiene el texto cifrado cargado.
- Un toque en Descifrar muestra el mensaje original.

**Resultado problemático / qué reportar si falla:**
- Si abre Safari en lugar del ícono instalado: iOS no está reconociendo la PWA como handler para su propia URL. Anotar la versión de iOS. Workaround documentado: el receptor puede copiar el código manualmente desde el mensaje de Telegram y pegarlo en el campo Descifrar.
- Si abre la PWA pero el campo aparece vacío: el fragment `#c=...` se perdió en la apertura desde Telegram (no en los redirects). Revisar en Safari DevTools (Mac → Desarrollador → [dispositivo]) qué `location.hash` llega a `app.js`.
- Si abre la PWA en modo browser tab (con barra URL): el manifiesto `display: standalone` no está siendo respetado al abrir desde Telegram. El deep link sigue funcionando, solo la presentación es diferente.

---

### 7.1-B. Vault bloqueado al recibir el deep link — ciphertext sobrevive el desbloqueo

**Contexto:** `pendingDeepLink` se setea en `init()` antes del check de vault, y `applyDeepLinkIfPending()` solo corre cuando `enterComposer()` es alcanzado. En teoría el ciphertext sobrevive el PIN o la pantalla de CLAVE_DESPLIEGUE. Este test confirma que es así en la práctica.

**Setup:**
- Dispositivo receptor con el vault bloqueado. Dos variantes:
  - **Variante A (PIN):** vault en modo PIN (Seguridad del dispositivo activada). La app muestra la pantalla PIN al abrirse.
  - **Variante B (primera apertura):** vault nunca desbloqueado en este dispositivo (primera vez o datos borrados). La app muestra la pantalla CLAVE_DESPLIEGUE.

**Pasos:**
1. Asegurarse de que la app está cerrada por completo en el receptor (force-close).
2. En el emisor: cifrar y enviar.
3. En el receptor: tocar el botón "Descifrar →" desde Telegram (sin haber abierto la app antes).
4. La app abre. Debería mostrar la pantalla de desbloqueo (PIN o CLAVE_DESPLIEGUE según variante).
5. Completar el desbloqueo normalmente.
6. La app entra al compositor.

**Resultado esperado:**
- El compositor muestra el modo **Descifrar** (no Cifrar).
- El textarea ya tiene el código cifrado cargado.
- El hint "Mensaje recibido — tocá Descifrar para leerlo." aparece debajo.
- Un toque en Descifrar muestra el mensaje original.
- El hash ya no figura en la barra de direcciones.

**Resultado problemático / qué reportar si falla:**
- Si el compositor abre en modo Cifrar con el textarea vacío: `pendingDeepLink` fue null al llegar a `enterComposer()`. Posible causa: el fragment se perdió antes de que `consumeDeepLink()` corriera. Revisar `location.hash` en DevTools en el momento exacto en que `init()` empieza.
- Si el compositor abre en modo Descifrar pero el textarea vacío: `applyDeepLinkIfPending()` corrió pero `pendingDeepLink` era null. Misma causa probable.
- Si la pantalla de desbloqueo muestra el textarea cifrado visible (sin haber desbloqueado): no debería ocurrir — `applyDeepLinkIfPending()` solo se llama desde `enterComposer()`, que requiere vault abierto. Si pasa, es una regresión en el flujo de pantallas.

### 7.1-C. Fragmento malformado — error descriptivo, sin crash

**Contexto:** si alguien comparte una URL con un `#c=` inválido (truncado, editado a mano, o con caracteres rotos), `applyDeepLinkIfPending()` pre-carga el campo y el usuario hace click en Descifrar. `descifrarMensaje()` ya valida defensivamente y lanza errores descriptivos — este test confirma que esa cadena funciona end-to-end desde un deep link real, sin crash ni mensaje críptico.

**Pasos:**
1. Abrir manualmente la URL: `https://misbusquedaspersonales-cyber.github.io/tango_cipher_bot_public/pwa/index.html#c=esto-no-es-un-codigo`
2. Desbloquear si es necesario.
3. El compositor debe abrirse en modo Descifrar con `esto-no-es-un-codigo` en el textarea.
4. Apretar Descifrar.

**Resultado esperado:** mensaje de error descriptivo en el status (ej. "Clave enmascarada no es un número: 'esto'"), sin crash, sin pantalla en blanco. La app sigue funcional — se puede limpiar el campo y usar normalmente.

---

## ✅ Checklist de regresión — Fase 10.1.1 (Web Share Target para documentos)

> ⚠️ **Requiere el APK real instalado (sideload), NO alcanza con la PWA
> instalada desde Chrome.** El intent-filter que hace aparecer "Tango
> Cifrado" en la hoja nativa de "Compartir" de Android se genera a partir
> de `twa-manifest.json` cuando se compila el APK — Chrome no lo expone
> de la misma forma para una PWA instalada vía navegador. Si corrés este
> checklist sobre la versión de Chrome y no aparece la app en "Compartir",
> **eso es esperado** y no es un bug — repetí sobre el `.apk`.

> 🔴 **Esta sección entera es para el build EXPERIMENTAL, no el recomendado.**
> El APK que se compila con los pasos normales de `build-apk.sh` /
> `PASOS_APK.md` ya NO incluye Web Share Target (ver M-5 en `TO_FIX.md`) —
> compilalo con `ALLOW_SHARE_TARGET=1 ../scripts/apk/build-apk.sh` para que
> este checklist tenga sentido. Si probás esta sección sobre el APK
> recomendado por defecto, "Tango Cifrado" no va a aparecer en el menú de
> Compartir — **eso es lo esperado ahora**, no el bug que este checklist
> intenta cazar.

**Pre-requisito:** compilaste el APK con `build-apk.sh` *después* de que
`sync-share-target.sh` corriera sin errores (lo hace automáticamente, ver
arriba). Si tenías una instalación vieja del APK (antes de este parche),
desinstalala primero — el intent-filter nuevo no aparece con un simple
update de contenido.

Esta sección valida el flujo completo de compartir archivos .txt desde Telegram usando el menú nativo "Compartir" del sistema operativo. Web Share Target tiene comportamientos específicos por plataforma que requieren verificación en dispositivo real.

### 10.1.1-A. Compartir un `.txt` desde Telegram → la app aparece como destino

**Setup:**
- Emisor: cualquier dispositivo, cifra un mensaje **largo** (>1200
  caracteres aprox., para forzar que `selectTransport()` elija
  `documentTransport` en vez de chunked-text) y lo envía a Telegram. Ver
  `core/transport/index.js` — el mensaje debe llegar como archivo
  `mensaje.txt` adjunto, no como texto plano en el chat.
- Receptor: teléfono Android con el **.apk real** instalado (no la PWA
  vía Chrome) y Telegram instalado.

**Pasos:**
1. En el receptor, abrir el chat de Telegram donde llegó `mensaje.txt`.
2. Mantener presionado el archivo (o usar el ícono de reenviar/compartir de Telegram) → **Compartir**.
3. En la hoja de compartir nativa de Android, buscar **"Tango Cifrado"** en la lista de apps.

**Resultado esperado:**
- "Tango Cifrado" aparece como destino de compartir (no solo "Guardar en Archivos" u otras apps genéricas de texto).
- Tocarlo abre la app en modo standalone (sin barra de Chrome) directamente en el compositor, modo **Descifrar**, con el ciphertext ya cargado en el textarea.
- Un toque en Descifrar muestra el mensaje original completo.

**Resultado problemático / qué reportar si falla:**
- **"Tango Cifrado" no aparece en la hoja de compartir en absoluto:** el APK instalado fue compilado antes de este parche, o `sync-share-target.sh` no corrió (revisar el output de `build-apk.sh` — debe decir "Proyecto Android regenerado con el share_target actual" o "ya está sincronizado"). Recompilar y reinstalar limpio.
- **Aparece pero el campo Descifrar queda vacío:** revisar en `chrome://inspect#devices` (WebView del APK) el flujo `handleShareTarget()` del service worker → IndexedDB `TangoCifradoSharedFiles` → `getSharedFileIfAvailable()` en `app.js`. Confirmar que `shared_file_ready=1` llega a la URL y que el registro `latest` existe en IndexedDB antes de que `init()` lo lea.
- **Abre Chrome en vez de la app:** el `AndroidManifest.xml` generado no tiene el intent-filter esperado — confirmar con `aapt2 dump xmltree app-release-signed.apk --file AndroidManifest.xml | grep -A5 SEND` que existe una `<action>` para `android.intent.action.SEND` con `<category>` `DEFAULT` apuntando a la actividad de la TWA.

### 10.1.1-B. iOS: limitaciones conocidas de Web Share Target

**Contexto:** iOS tiene soporte limitado para Web Share Target, especialmente para archivos. El comportamiento puede variar entre versiones de Safari.

**Pasos (iOS 15+):**
1. Repetir el flujo del punto 10.1.1-A en dispositivo iOS.
2. En Telegram iOS, intentar compartir el archivo .txt.

**Resultado esperado (puede variar por versión iOS):**
- iOS 16+: comportamiento similar a Android, "Tango Cifrado" puede aparecer en el menú compartir.
- iOS 15 y anteriores: Web Share Target para archivos no está soportado. Fallback esperado: el usuario debe usar el flujo manual (abrir la app, usar el botón "Abrir archivo cifrado", seleccionar el archivo descargado).

**Documentar si falla:** 
- Anotar la versión exacta de iOS y Safari.
- Confirmar que el fallback manual funciona correctamente.
- El flujo de deep links (`?c=` para mensajes cortos) debe seguir funcionando normalmente en iOS.

### 10.1.1-C. Limpieza de IndexedDB temporal tras lectura exitosa

**Contexto:** El Service Worker almacena archivos compartidos temporalmente en IndexedDB con la clave `'latest'`. Después de que `getSharedFileIfAvailable()` lee el archivo, debe limpiarlo automáticamente para evitar acumulación de datos sensibles.

**Pasos:**
1. Completar el flujo 10.1.1-A exitosamente (archivo compartido → app abre → ciphertext pre-cargado → descifrado exitoso).
2. Force-close completo de la app.
3. Reabrir la app normalmente (sin compartir nada nuevo).
4. Verificar que no hay ciphertext pre-cargado en el campo Descifrar.

**Resultado esperado:**
- La app abre normalmente en modo Cifrar (o último modo usado).
- No hay texto pre-cargado en ningún campo.
- El parámetro `?shared_file_ready=1` no aparece en la URL.

**Para debugging avanzado (opcional):**
- En DevTools → Application → IndexedDB → `TangoCifradoSharedFiles` → `files` object store.
- Después del paso 1: debe existir un entry con `id: 'latest'`.
- Después del paso 4: el entry debe haber sido eliminado (`getRequest.result` debería ser undefined).

### 10.1.1-B. Fallback manual sigue funcionando (sin Web Share Target)

Confirmar que el botón **"Abrir archivo cifrado"** (`#open-file-button` →
`<input type="file">`) del compositor en modo Descifrar sigue funcionando
para abrir `mensaje.txt` manualmente (guardado con "Guardar" desde
Telegram en vez de "Compartir"). Debe dar el mismo resultado que el paso
10.1.1-A — este es el camino de respaldo si Share Target falla en algún
dispositivo/versión de Android.

