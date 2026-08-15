# TROUBLESHOOTING

> NOTE: Canonical APK build, verification, and transfer steps moved to [APK_BUILD.md](APK_BUILD.md).
> `TROUBLESHOOTING.md` remains the user-facing troubleshooting manual; for build-process updates consult `APK_BUILD.md`.


> **Actualizado 2026-08-14**: problemas resueltos marcados como ✅ RESUELTO con referencias históricas. Para issues de prioridad media/baja y mejoras no bloqueantes, consultá [TO_FIX.md](TO_FIX.md).

> Nota: si querés revisar los problemas pendientes y los items de mejora no bloqueantes, consultá [TO_FIX.md](TO_FIX.md). Allí se mantiene el seguimiento de los issues de prioridad media/baja que no afectan el uso normal de la app.

## 🚨 **Problema crítico: APK con Web Share Target no instala en ciertos dispositivos Android**

**Síntomas**: El APK descarga correctamente pero falla al instalar con error genérico de instalación.

**Causa raíz**: Los intent-filters de Web Share Target (`android.intent.action.SEND` + `SEND_MULTIPLE`) generados automáticamente por Bubblewrap causan conflictos de instalación en ciertos dispositivos/versiones Android.

**Solución verificada**: Usar APK compilado sin Web Share Target:
1. En `tango-cifrado-apk/twa-manifest.json`, remover completamente la sección `shareTarget`
2. Ejecutar `bubblewrap update --skipVersionUpgrade` 
3. Corregir manualmente versiones en `app/build.gradle` (ver M-4 en TO_FIX.md)
4. Compilar con `bubblewrap build`

**APK funcional disponible**: `tango-cifrado-NO-SHARE-TARGET.apk` (sin Web Share Target, instalación exitosa verificada)

**Limitación**: Sin Web Share Target, los usuarios no pueden compartir archivos `.txt` desde Telegram directamente con la app usando el menú "Compartir" nativo. Deben usar el flujo manual: abrir app → botón file input → seleccionar archivo descargado.

**Investigación pendiente**: Determinar si es incompatibilidad Android/TWA, error de configuración Bubblewrap, o requisito de versión mínima Android para Web Share Target en TWAs.

---

## `bubblewrap build` pregunta "There are changes in twa-manifest.json... apply them?" y después pide `versionName`

### Cuándo aparece

Corriendo `build-apk.sh` (o `bubblewrap build` directo) después de haber editado `twa-manifest.json` a mano, o después de que un script (como `sync-share-target.sh` fuera del caso puntual de `share_target`, o cualquier otro ajuste manual) haya tocado el archivo.

### Por qué pasa

`bubblewrap build` guarda un checksum de `twa-manifest.json` en el momento en que genera el proyecto Android. En cada build posterior, compara ese checksum contra el archivo actual — si no coincide, entiende que hubo cambios manuales y pregunta si querés aplicarlos antes de compilar. Decir que sí dispara, por dentro, el equivalente de `bubblewrap update`, que por defecto bumpea la versión de la app y pide un `versionName` nuevo.

**Esto es distinto y no está cubierto por `sync-share-target.sh`.** Ese script solo evita el prompt/bump de versión en un caso puntual: cuando el cambio detectado es específicamente `share_target` (usa `bubblewrap update --skipVersionUpgrade` para ese caso). Cualquier otro cambio a `twa-manifest.json` — manual o de otro script — sigue disparando este prompt, porque `--skipVersionUpgrade` **solo existe en el comando `bubblewrap update`, no en `bubblewrap build`**. No hay forma de suprimirlo únicamente con flags de `build`.

### Qué responder

1. `Would you like to apply them...?` → **Yes**.

2. `versionName for the new App version:` → cualquier string mayor al `versionName` actual de `twa-manifest.json` (ver el campo `"versionName"` del archivo). Seguir el esquema `MAJOR.MINOR.PATCH` ya usado en el proyecto — por ejemplo, si el actual es `1.3.3`, poner `1.3.4`.

Después de confirmar la versión, el build sigue normalmente sin más prompts.

### ¿Se puede automatizar para que no pregunte nunca?

Sí, agregando un paso a `build-apk.sh` que corra `bubblewrap update --skipVersionUpgrade` de forma proactiva antes de `bubblewrap build` en cada ejecución — así el checksum queda "asentado" y `build` nunca encuentra drift que preguntar.

**A propósito, no se hizo.** El historial de este proyecto tiene dos bugs (`TO_FIX.md` M-4 y M-5) causados exactamente por cambios de versión o configuración de `twa-manifest.json` aplicándose en silencio sin que nadie los revisara. Este prompt ocasional, aunque interrumpe el build, funciona como una salvaguarda barata: obliga a mirar y confirmar antes de firmar un APK con una config distinta a la esperada. Si en algún momento se automatiza (por ejemplo, para que corra en CI sin supervisión humana), asegurarse de que el pipeline valide la versión resultante *después* del build (como ya hace el paso de verificación con `pyaxmlparser`), no solo confiar en que el bump automático fue el esperado.

----

## Monitorear la guardia de seguridad durante `build-apk.sh`

### Qué mirar en la salida del build

Durante la ejecución de `build-apk.sh`, **prestá atención a estos mensajes** que indican si la guardia de seguridad funciona:

#### ✅ **Guardia funcionando correctamente (esperado):**
```
⚠️  pwa/manifest.json tiene share_target pero twa-manifest.json no
(removido a propósito, ver TO_FIX.md M-5). NO se re-agrega
automáticamente. Usá ALLOW_SHARE_TARGET=1 si esto es intencional.
✅ share_target ya está sincronizado en twa-manifest.json -- nada que regenerar.
```

Esa línea confirma que el freno de seguridad está funcionando y no reintroducirá Web Share Target por accidente.

#### ⛔ **PELIGRO: Guardia NO funcionando (detener build):**
```
Proyecto Android regenerado con el share_target actual
```
```
Running: bubblewrap update
```

Si ves que el script sincroniza `shareTarget` y corre `bubblewrap update`:
1. **❌ DETENÉ el build inmediatamente** (Ctrl+C)
2. **⚠️ Algo no aplicó bien el parche 0013 de seguridad**  
3. **🚫 NO instalés el APK resultante** — tendrá el bug de instalación de vuelta

#### 🔧 **Cómo forzar la guardia manualmente:**

Si necesitás deshabilitar Web Share Target temporalmente:
```bash
# NO agregar shareTarget automáticamente (estado seguro)
cd tango-cifrado-apk
../scripts/apk/sync-share-target.sh
```

Si necesitás habilitarlo explícitamente (solo para debugging):
```bash 
# Agregar shareTarget (puede causar fallos de instalación)
ALLOW_SHARE_TARGET=1 ../scripts/apk/sync-share-target.sh
```

### Por qué esta guardia es crítica

Sin esta guardia, `sync-share-target.sh` detecta que `pwa/manifest.json` tiene `share_target` y `twa-manifest.json` no, y automáticamente copia el `shareTarget` — reintroduciendo en silencio el bug de instalación "There was a problem parsing the package" que se resolvió sacándolo (ver `TO_FIX.md` M-5).

----

---

## Problema 1: No tengo el CHAT_ID de Telegram

### Paso 1: Inicia una conversación con tu bot
Abre Telegram, busca tu bot y envíale cualquier mensaje (`/start` o `hola`).

> El bot no responderá — es un canal unidireccional. Enviar ese primer mensaje solo sirve para que Telegram registre tu cuenta y genere un `update` que podamos consultar.

### Paso 2: Consulta los updates del bot

```bash
curl "https://api.telegram.org/bot<TU_BOT_TOKEN>/getUpdates"
```

### Paso 3: Localiza tu CHAT_ID

```json
{
  "result": [
    {
      "message": {
        "chat": {
          "id": 1341610334,
          "first_name": "Tu Nombre"
        },
        "text": "hola"
      }
    }
  ]
}
```

El valor de `"id"` dentro de `"chat"` es tu `CHAT_ID`.

### Paso 4: Agrega los valores a `.env`

```
TELEGRAM_BOT_TOKEN=<tu_token>
TELEGRAM_CHAT_ID=<tu_chat_id>
```

---

## Problema 2: `getUpdates` devuelve lista vacía (`"result": []`)

El bot no ha recibido mensajes aún, o los mensajes expiraron (Telegram los descarta después de 24 h sin leer).

1. Abre el chat con el bot en Telegram y envía `/start`.
2. Ejecuta el `curl` del Paso 2 inmediatamente después.

---

## Problema 3: `getUpdates` devuelve "Unauthorized" (Error 401)

El token es incorrecto o fue revocado. Ve a `@BotFather`, usa `/mybots` → selecciona tu bot → `API Token` → `Revoke current token` y genera uno nuevo.

---

## Problema 4: El script crashea con "ID de tango no encontrado"

El número que ingresaste en el prompt no existe en tu `tangos.json`. Los IDs válidos dependen de cuántos tangos hayas agregado a tu corpus privado. El script muestra un mensaje de error claro y termina de forma limpia.

---

## Problema 5: Error al enviar a Telegram (timeout o sin conexión)

`telegram_client.py` captura `Timeout`, `ConnectionError` y errores HTTP sin crashear. Si ves "Error al enviar mensaje a Telegram", verifica:

1. Conexión a internet activa.
2. `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` correctos en `.env`.
3. El bot no fue bloqueado o eliminado en Telegram.

---

## Problema 6: La PWA pide `CLAVE_DESPLIEGUE` cada vez que abro la app

No debería ocurrir con el flujo por defecto. La `CLAVE_DESPLIEGUE` se solicita **una sola vez** en el primer arranque para descifrar el bundle. El payload queda guardado en IndexedDB del dispositivo (`savePayloadDirect`). Los arranques posteriores lo cargan directamente sin pedir nada.

Si la PWA vuelve a pedir la clave, significa que IndexedDB fue borrado (limpieza de datos del browser, modo incógnito, o reinstalación). Ingresa la `CLAVE_DESPLIEGUE` nuevamente para reactivar.

---

## Problema 7: `cryptography` no está instalado (error al correr tests del bundle)

```bash
pip install cryptography
```

Si el entorno lo bloquea:

```bash
pip install cryptography --break-system-packages
```

O instalar dentro del virtualenv:

```bash
python3 -m venv venv && source venv/bin/activate && pip install requests python-dotenv cryptography
```

---

## Problema 8: La URL de GitHub Pages muestra 404 (Not Found) o está desactualizada

El despliegue en GitHub Pages puede tardar un par de minutos después de realizar el push.
1. Abre tu repositorio público en GitHub.
2. Ve a la pestaña **Settings** -> **Pages**.
3. Verifica que diga "Your site is live at...".
4. Asegúrate de navegar a `/pwa/index.html` si los archivos de la app se encuentran en la carpeta `pwa/` (ejemplo: `https://misbusquedaspersonales-cyber.github.io/tango_cipher_bot_public/pwa/index.html`).
5. Si ves una versión vieja, fuerza la actualización en tu móvil (limpiar caché o arrastrar hacia abajo para refrescar en Safari/Chrome).

---

## Problema 8.1: La URL remota de git tiene un token embebido

La URL de `origin` no debe contener un PAT en texto claro como `https://<token>@github.com/...`. Este token puede quedar expuesto en la configuración local de git, en respaldos o en cualquier salida de `git remote -v`.

**Síntoma:** `git remote -v` muestra un URL con un token embebido en lugar de una URL limpia.

**Solución:**
1. Reemplaza la URL remota por una versión limpia:
   ```bash
git remote set-url origin https://github.com/misbusquedaspersonales-cyber/tango_cipher_bot_public.git
```
2. Verifica que quedó limpia:
   ```bash
git remote get-url origin
```
3. No guardes tokens en la URL remota. Usa un helper de credenciales o variables/Secrets de GitHub Actions.

---

## Problema 9: El repo privado y el repo público no están sincronizados (Drift)

Este proyecto usa un modelo de dos repos para separar lo sensible de lo público:
- El repo privado contiene el core sensible (`tangos.json`, el SALT y la lógica privada de compilación).
- El repo público contiene la PWA y el bundle cifrado que se despliega en GitHub Pages.

Si el repositorio privado avanza con nuevos tangos o correcciones y este repositorio público no se actualiza (lo que se conoce como *drift*), el modelo prevé una verificación automática mediante un workflow `drift-check.yml` que correría semanalmente y abriría un **GitHub Issue** si detecta que `PRIVATE_CORE_COMMIT` ha quedado viejo.

> El workflow `drift-check.yml` corre automáticamente cada lunes. Si el secreto `PRIVATE_REPO_PAT` no está configurado en este repo público, el workflow fallará — ver Problema 11 para crearlo.

Cuando detectes drift (por alerta automática o por comprobación manual), deberás buscar el nuevo SHA en el repositorio privado, actualizar la variable `PRIVATE_CORE_COMMIT` en `scripts/dev/setup_private_core.sh`, y correr el script localmente para sincronizar tu entorno (detalle paso a paso en Problema 11).

---

## Problema 10: El workflow `build-encrypted-bundle.yml` falla en el paso "Push to PUBLIC repo"

**Síntoma:** el job `build` termina bien (bundle generado, smoke-test OK) pero `deploy-to-public-repo` falla en el último paso con error de autenticación o permisos de push.

**Causa raíz más común:** el secreto `PUBLIC_REPO_DEPLOY_TOKEN` en el **repo privado** está ausente, expirado, o fue creado con permisos insuficientes.

> Nota: en `.env` local este token se guarda bajo la clave `PUBLIC_REPO_DEPLOY_TOKEN`, que es también el nombre del secreto en GitHub Actions.

**Solución:**
1. Generá (o regenerá) un Personal Access Token con permiso **Contents: write** restringido **solo** al repo público `tango_cipher_bot_public`. Fine-grained PAT es lo recomendado (menor blast radius si se filtra).
2. Ve al **repo privado** → Settings → Secrets and variables → Actions → buscá `PUBLIC_REPO_DEPLOY_TOKEN`.
3. Si no existe → **New repository secret**. Si existe → **Update**.
4. Pegá el nuevo token y guardá.
5. Volvé a correr el workflow desde Actions → **Run workflow** (workflow_dispatch).

---

## Problema 11: El workflow `drift-check.yml` falla por error de autenticación

El workflow de GitHub Actions diseñado para detectar si el repositorio privado avanzó (drift-check) requiere acceso de lectura al repositorio privado, el cual no está permitido de forma predeterminada.

**Síntoma:** El Action en la pestaña *Actions* falla con un error como `No se pudo obtener el SHA del repositorio privado. Verifica PRIVATE_REPO_PAT.` o un mensaje de error de autenticación de `git ls-remote`.

**Solución:**
1. Ve a tu cuenta de GitHub -> **Settings** -> **Developer settings** -> **Personal access tokens** (Tokens classic o Fine-grained).
2. Genera un nuevo token con permisos de lectura para el repositorio privado (scope `repo`).
3. Copia el token generado.
4. Ve a la pestaña **Settings** de **este repositorio público**, entra a **Secrets and variables** -> **Actions** -> **New repository secret**.
5. Crea un secreto llamado `PRIVATE_REPO_PAT` y pega allí tu token.

---

## ~~Problema 12: El workflow `drift-check.yml` no existe en el repo~~ ✅ RESUELTO

**✅ RESUELTO** — `.github/workflows/drift-check.yml` existe y corre semanalmente (lunes 08:00 UTC).

**Para referencia histórica**: Si se abre un Issue etiquetado `drift`, significa que el workflow detectó que `PRIVATE_CORE_COMMIT` en `scripts/dev/setup_private_core.sh` quedó viejo respecto al HEAD del repo privado. El workflow requiere el secreto `PRIVATE_REPO_PAT` configurado (ver Problema 11).

---

## Problema 13: La PWA no se instala en Android o funciona mal en móvil

Este problema agrupa todos los fallos móviles Android y de despliegue a Pages. La app está preparada para correr en celulares (tanto en instalación standalone como en navegador), pero hay 7 puntos típicos donde un deploy puede romperse en la práctica.

> 📌 **Para validación**: usar el checklist completo de `MOBILE_TESTING.md` §1–§7 antes de aprobar cualquier deploy.

---

### 13.1 Síntoma: Chrome Android no muestra "Instalar app" (solo "Agregar a página principal")

Chrome solo ofrece **Instalar app** (PWA de verdad, standalone, sin barra de navegación) cuando se cumplen **todos** los requisitos siguientes. Falla uno → no hay banner, solo un shortcut de bookmark.

**Diagnóstico uno-por-uno (Chrome → DevTools → Application, conectado por USB con `chrome://inspect#devices`):**

| Paso | Qué mirar | Esperado → ¿Qué pasa si falla? |
|---|---|---|
| 1 | `pwa/manifest.json` linkeado en `index.html` | Debe existir `<link rel="manifest" href="./manifest.json">` en `<head>`. Si no está → agregalo y pusheá de nuevo. |
| 2 | Manifest carga por HTTP 200 | En DevTools → Application → Manifest. Si dice "no manifest found" o HTTP 404 → falta el archivo o el path `/pwa/manifest.json` no coincide. |
| 3 | `display: standalone` en manifest | Campo obligatorio. Si dice `browser` o no está → Chrome nunca ofrece "Instalar app". |
| 4 | Ícono 192×192 PNG + Ícono 512×512 PNG | Deben estar ambos, tipo `image/png`, `sizes` correcto. **Si falta cualquiera de los dos → no hay install prompt.** |
| 5 | Service Worker registrado + handler `fetch` | DevTools → Application → Service Workers. Si "Registration failed" o "No service workers detected" → abrí Consola y buscá errores de `serviceWorker.register()`. Los más comunes: (a) SW servido con MIME type `text/html` porque `.nojekyll` faltó y Jekyll lo transformó, (b) path relativo mal: el SW es `./service-worker.js` y debe estar en la misma carpeta que `index.html` (scope). |
| 6 | Corriendo sobre **HTTPS real** o `localhost` | El deploy de Pages lo hace HTTPS automático con `https_enforced=true`. Si estás probando desde `http://192.168.1.x:puerto` en LAN → Chrome bloquea la instalación. Solo se puede instalar desde `localhost` (loopback) o HTTPS. |
| 7 | HTTPS sin errores de certificado | Si el navegador marca "⚠️ No seguro" en Pages → probablemente el custom domain tiene certificado roto. Sin custom domain Pages lo hace bien auto. |

**Arreglo más común de todos los casos (80%):** falta `.nojekyll` y los assets `service-worker.js`, `manifest.json`, o `fonts/` con guion bajo están siendo omitidos por Jekyll. Agregalo en **ambos** niveles:
```bash
ls -la .nojekyll pwa/.nojekyll
# Si alguno falta:
touch .nojekyll pwa/.nojekyll && git add .nojekyll pwa/.nojekyll && git commit && git push
```

---

### 13.2 Síntoma: Las URLs cortas dan 404 (`/` raíz o `/go.html`)

Estos redirects existen para no tener que escribir la ruta larga en el teclado del móvil (errores de tipeo muy frecuentes). Si dan 404 es **siempre** uno de estos dos casos:

**Caso A: Los archivos no están pusheados a `main` (untracked).**
```bash
git status index.html go.html pwa/go.html
# Si aparecen en "Untracked files" → no van a GitHub Pages.
git add index.html go.html pwa/go.html
git commit -m "feat: root short URL redirects" && git push origin main
```

**Caso B: El push entró pero GitHub Pages aún no construyó.**
Pages suele tardar 30–90s después de un push. Esperá, hacé **hard-refresh** en Chrome Android (menú ⋮ → botón ↻ circular) y si aún así falla esperá 2 minutos más. Podés chequear el estado de construcción en:
```
Repo público → Settings → Pages → "Your site is live at https://…"
                                                        ↑ debe decir "published" hace <2 min.
```

---

### 13.3 Síntoma: "Instalé la app pero sigue apareciendo la barra de URL de Chrome"

Significa que no está en modo `standalone`, sino que es un shortcut de browser. Diagnóstico:

1. **Borrá el shortcut actual** de Home Screen (mantenelo apretado → quitar) — no lo reutilices.
2. Volvé a abrir **directamente** `https://misbusquedaspersonales-cyber.github.io/tango_cipher_bot_public/pwa/index.html` (no desde el redirect primero).
3. Esperá que cargue completamente (incluido el SW install, ~1–2s).
4. ⋮ → **Instalar app** (NO "Agregar a página principal").

Si aún así sigue con barra URL → revisá `apple-mobile-web-app-capable` meta tag en `index.html` (solo iOS lo requiere; Android usa manifest). Para Android el único requisito es `display: standalone` en `manifest.json` y que el Service Worker scope cubra `./` (lo hace porque está en la misma carpeta).

---

### ~~13.4 Síntoma: Modo Avión no funciona o muestra error críptico "HTTP 0"~~ ✅ RESUELTO

**✅ RESUELTO** — El parche de caché v5→v13 + `checkBundleFreshness()` + Service Worker `controllerchange` auto-reload eliminó el error "HTTP 0 sin contexto".

**Para referencia histórica**: había dos escenarios distintos según si el bundle estaba cacheado. El Service Worker v13+ maneja ambos casos correctamente con mensajes claros en español.

---

### 13.4 Síntoma: Teclado QWERTY para el PIN (en vez de numérico) / notch corta contenido

**PIN con teclado equivocado (QWERTY):** Faltan los `inputmode="numeric"` en los campos PIN. Verificá `index.html` → el `<input id="new-pin">`, `<input id="confirm-pin">`, y `<input id="device-pin">` tienen que tener **tres** de ellos con `inputmode="numeric"`. Si no → Android no sabe que es campo numérico y abre QWERTY.

**Contenido cortado por notch / cámara selfie / punch-hole (safe-area):**
- Body debe tener padding con `env(safe-area-inset-top/right/bottom/left)` (línea 71 de `index.html`)
- Meta viewport debe incluir `viewport-fit=cover` (línea 5 de `index.html`)
- Si falta cualquiera → el notch tapa el título / el botón Desbloquear. No requiere re-deploy a veces si el CSS ya está bien; si el teléfono tiene Android 10+ y safe-area desactivado globalmente es un setting del launcher.

---

### ~~13.5 Síntoma: Actualicé el corpus pero la app móvil sigue mostrando tangos viejos~~ ✅ RESUELTO

**✅ RESUELTO** — `checkBundleFreshness()` implementado en `pwa/app.js` detecta automáticamente cuando hay un bundle nuevo en el servidor y fuerza al usuario a re-desbloquear para obtener el corpus actualizado.

**Para referencia histórica**: el problema era que el Service Worker usaba cache-first para el bundle, y la app móvil no detectaba cambios automáticamente.

---

### 13.6 Checklist ultra rápido: 6 comandos + 3 clicks para aprobar un deploy móvil

Previo a dar un deploy por bueno en un celular real, ejecutá **en la raíz de la copia local del repo público**:

```bash
# 1) ¿.nojekyll en AMBOS niveles?
ls -la .nojekyll pwa/.nojekyll
# → OK: dos lineas, ninguno muestra "No such file"

# 2) ¿Short URL redirects tracked?
git status --short index.html go.html pwa/go.html
# → OK: no aparecen (están committed)
# → MAL: aparece ?? (untracked) → git add && git commit && push

# 3) ¿Asset integrity (ninguna referencia rota en HTML/JS)?
python3 scripts/dev/check_pwa_assets.py
# → OK: "todos los assets referenciados existen..."

# 4) ¿Test suite pública pasa (24 Python always-runnable + 53 JS)?
python3 -m pytest tests/python/test_build_encrypted_bundle.py tests/python/test_telegram_client.py tests/python/test_check_coverage.py -q
npm test
# → OK: 24 passed / 53 pass

# 5) ¿Bundle schema correcto y generated_at nuevo?
python3 -c '
import json,base64,pathlib
b=json.loads(pathlib.Path("pwa/encrypted-bundle.json").read_text())
assert b["version"]==1 and b["aad"]=="tango-cifrado-bundle-v1"
assert len(base64.b64decode(b["nonce_b64"]))==12
assert len(base64.b64decode(b["kdf_salt_b64"]))==16
assert "generated_at" in b; print("generated_at =",b["generated_at"])'
# → OK: generated_at posterior a tu deploy date

# 6) ¿Push command es plain (no fake flags de force)?
grep -A3 "Push to PUBLIC repo" .github/workflows/build-encrypted-bundle.yml | grep "git push"
# → OK: exactamente "git push origin main"
# → MAL: aparece "--ff-only" (flag inválido, rompe antes de conectarse) o "--force-with-lease" (sobreescribe)
```

**Luego, en el celular Android (3 clicks):**
```
Click 1: Abrir short URL (https://…/tango_cipher_bot_public/)  →  redirige en ≤1s
Click 2: ⋮ → Instalar app → abrir desde ícono                     →  sin barra URL
Click 3: Desbloquear una vez, activar Modo Avión, volver a abrir  →  abre instantáneo,
                                                                      sin error críptico.
```

Si las 6 comandos + 3 clicks pasan, el deploy está aprobado para uso diario móvil Android y GitHub Pages.

---

## Problema 14: Cómo configurar el Chat ID para comunicación entre dos personas

### Contexto

El chat ID en `.env` (`TELEGRAM_CHAT_ID=1341610334`) es el DM privado entre el bot y un único usuario. Mensajes enviados a ese ID solo los ve esa persona. Para que dos personas puedan intercambiar mensajes cifrados, necesitan un chat compartido o intercambiar sus IDs personales.

---

### Opción A — Grupo compartido (para primeros intentos)

La más simple para empezar: ambas personas están en el mismo grupo y ven todos los mensajes.

**Setup (una sola vez):**

1. Crear un grupo en Telegram. Agregar a ambos participantes y al bot `@ukotango_bot`.
2. Mandar cualquier mensaje en el grupo (necesario para que `getUpdates` lo detecte).
3. Obtener el chat ID del grupo — ejecutar desde terminal:

```bash
TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' /root/JOB-sda2/CIFRADO-TANGOS/Tango/.env | cut -d= -f2)
curl -s "https://api.telegram.org/bot${TOKEN}/getUpdates" \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
for u in data.get('result', []):
    chat = u.get('message', {}).get('chat', {})
    print(chat.get('type'), chat.get('id'), chat.get('title', chat.get('first_name','')))
" | sort -u
```

El grupo aparece con `type=group` o `supergroup` y un ID negativo (ej: `-1001234567890`).

4. Ambos configuran ese ID en la PWA: Ajustes → Chat ID → Guardar.

**Uso:**
- Cualquiera cifra y envía → el mensaje llega al grupo → el otro toca "Descifrar →" → descifra.
- Ambos ven el historial de mensajes cifrados en el chat del grupo.

**Limitación:** todos los mensajes los ve cualquiera en el grupo. Para conversación privada real, usar Opción B.

---

### Opción B — Chat IDs cruzados (uso final, máxima privacidad)

Cada persona envía directamente al DM del bot del otro. Nadie más ve los mensajes.

**Setup:**

1. Tu cliente abre Telegram y envía `/start` a `@ukotango_bot`. Esto abre un DM privado y registra su chat ID.

2. Obtener el chat ID de tu cliente — después de que mande `/start`, ejecutar:

```bash
TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' /root/JOB-sda2/CIFRADO-TANGOS/Tango/.env | cut -d= -f2)
curl -s "https://api.telegram.org/bot${TOKEN}/getUpdates" \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
for u in data.get('result', []):
    chat = u.get('message', {}).get('chat', {})
    if chat.get('type') == 'private':
        print('chat_id:', chat.get('id'), '|', chat.get('first_name',''), chat.get('last_name',''))
" | sort -u
```

Aparecerán todos los DMs privados que tuvieron con el bot. Identificar el de tu cliente por nombre.

3. Configuración cruzada:
   - **Vos**: ponés el chat ID de tu cliente en tu PWA (Ajustes → Chat ID). Tus mensajes le llegan a él.
   - **Tu cliente**: pone tu chat ID (`1341610334`) en su PWA. Sus mensajes te llegan a vos.

4. Si `getUpdates` devuelve lista vacía: el bot no recibió mensajes recientes. Pedir al cliente que mande `/start` de nuevo, esperar 10 segundos, y repetir el curl.

**Limitación de `getUpdates`:** solo devuelve los últimos 100 updates y los marca como "leídos" en cada llamada. Si ya los consumiste antes (por ejemplo, el bot los procesó), no aparecen de vuelta. En ese caso, el cliente puede reenviar `/start` para generar un update nuevo.

---

### Verificar que el chat ID es correcto antes de usarlo en producción

```bash
TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' /root/JOB-sda2/CIFRADO-TANGOS/Tango/.env | cut -d= -f2)
CHAT_ID="<el-id-que-queres-verificar>"
curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\": \"${CHAT_ID}\", \"text\": \"test de verificación\"}" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok:', d.get('ok'), d.get('description',''))"
```

`ok: True` → el ID es correcto y el bot tiene acceso a ese chat.
`ok: False` + `"chat not found"` → ID incorrecto o el usuario nunca mandó `/start` al bot.
`ok: False` + `"bot was kicked"` → el bot fue removido del grupo.

---

## Problema 15: El archivo `keystore-password.txt` aparece en exports del workspace

### Qué pasó ✅ RESUELTO

**✅ RESUELTO** — La keystore activa está ahora en `~/tango-signing/`, fuera del workspace. Las herramientas de export solo escanean el workspace.

**Para referencia histórica**: existían herramientas que generaban dumps del workspace sin respetar `.gitignore`, exponiendo contraseñas de keystores anteriores.

---

## Problema 16: DAL tool devuelve `ERROR_CODE_FETCH_ERROR` para `misbusquedaspersonales-cyber.github.io`

### Qué pasó ✅ RESUELTO

**✅ RESUELTO** — Se creó el repo `misbusquedaspersonales-cyber.github.io` como GitHub Pages raíz del usuario, conteniendo el `assetlinks.json` en la ubicación correcta.

**Para referencia histórica**: Digital Asset Links requiere el archivo en el root domain, pero GitHub Pages de proyecto lo servía en una subcarpeta.

---

## ~~Problema 17: `build-twa-apk` falla en `Install @bubblewrap/cli` con exit code 130~~ ✅ RESUELTO

**✅ RESUELTO** — El flag `--ignore-scripts` en `npm install -g` elimina el prompt interactivo de JDK que causaba el exit code 130 en CI.

**Para referencia histórica**: `@bubblewrap/cli` incluía un script `postinstall` interactivo que preguntaba sobre instalar JDK, incompatible con CI donde stdin está cerrado.

---

## Problema 18: Los secrets de GitHub Actions no se copian al migrar a un nuevo repositorio

### Síntoma

Después de crear un repositorio nuevo (o de clonar el código a una nueva cuenta/org),
el workflow `build-twa-apk` falla en el step **Required secrets guard** con:

```
❌ Falta el secreto ANDROID_KEYSTORE_B64 (android.keystore en base64).
```

aunque vos sabés que ya configuraste esos secrets en el repositorio anterior.

### Causa

**GitHub Secrets no son parte del repositorio git.** No se clonan, no se transfieren y no
aparecen en ningún backup del código. Son configuración de la plataforma GitHub, almacenada
en la infraestructura de GitHub asociada a ese repositorio/org específico.

Cada vez que se usa un repositorio nuevo, los secrets deben reconfigurarse. Intentar
copiarlos tampoco es posible: GitHub los muestra como `••••••••` y no los permite exportar.

### Solución — Configuración programática con `gh` CLI (sin navegador)

Si tenés la keystore en `~/tango-signing/` y el `GITHUB_TOKEN` en `.env`, podés
re-configurar todos los secrets en segundos desde la terminal, sin abrir el navegador:

```bash
# 1. Cargar el token desde .env
GH_TOKEN=$(grep ^GITHUB_TOKEN .env | cut -d= -f2)

# 2. Verificar que el token es válido y tiene acceso al repo
curl -s -H "Authorization: Bearer $GH_TOKEN" \
  https://api.github.com/repos/misbusquedaspersonales-cyber/tango_cipher_bot_public \
  | grep '"name"'
# → "name": "tango_cipher_bot_public"  ← OK

# 3. Configurar la contraseña de la keystore
GH_TOKEN="$GH_TOKEN" gh secret set ANDROID_KEYSTORE_PASSWORD \
  -b "$(cat ~/tango-signing/keystore-password.txt)" \
  -R misbusquedaspersonales-cyber/tango_cipher_bot_public

# 4. Configurar el archivo keystore (codificado en base64, sin saltos de línea)
base64 -w0 ~/tango-signing/android.keystore | \
  GH_TOKEN="$GH_TOKEN" gh secret set ANDROID_KEYSTORE_B64 \
  -R misbusquedaspersonales-cyber/tango_cipher_bot_public

# 5. Verificar que quedaron registrados
GH_TOKEN="$GH_TOKEN" gh secret list \
  -R misbusquedaspersonales-cyber/tango_cipher_bot_public
# → ANDROID_KEYSTORE_B64      Updated ...
# → ANDROID_KEYSTORE_PASSWORD Updated ...

# 6. Disparar el build
GH_TOKEN="$GH_TOKEN" gh workflow run build-twa-apk.yml \
  -R misbusquedaspersonales-cyber/tango_cipher_bot_public
```

> ℹ️ La keystore debe estar en `~/tango-signing/android.keystore` (fuera del workspace,
> como documenta `PASOS_APK.md`). Si usaste `generate-keystore.sh` en otra máquina,
> copiá el archivo por SCP o desde un backup cifrado antes de correr los comandos.

### Por qué `gh auth status` puede fallar aunque los comandos funcionen

`gh auth status` usa la sesión OAuth interactiva configurada con `gh auth login`.
En entornos donde no se hizo ese login, el comando falla con `"Timeout trying to log in"`.

Sin embargo, **`gh` acepta el token directamente vía la variable de entorno `GH_TOKEN`**,
que es exactamente lo que hacen los comandos de arriba. Si `GH_TOKEN=<token> gh secret set`
funciona, el token está bien aunque `gh auth status` diga error.

### Otros secrets que pueden necesitar reconfigurarse

| Secret | Repo donde va | Descripción |
|---|---|---|
| `ANDROID_KEYSTORE_B64` | **público** `tango_cipher_bot_public` | Keystore en base64 |
| `ANDROID_KEYSTORE_PASSWORD` | **público** `tango_cipher_bot_public` | Contraseña de la keystore |
| `ANDROID_KEY_ALIAS` | **público** (opcional) | Default: `android` |
| `ANDROID_KEY_PASSWORD` | **público** (opcional) | Default: = KEYSTORE_PASSWORD |
| `CLAVE_DESPLIEGUE` | **privado** `tango_corpus_private` | Passphrase AES del bundle |
| `CIFRADO_SALT` | **privado** `tango_corpus_private` | SALT numérico del cifrado |
| `PUBLIC_REPO_DEPLOY_TOKEN` | **privado** `tango_corpus_private` | PAT para push al repo público |
| `PRIVATE_REPO_PAT` | **público** `tango_cipher_bot_public` | PAT de lectura al repo privado |

---

## Problema 19: Cambios estructurales en la interfaz no se reflejan en la app móvil instalada

### Síntoma

Después de actualizar el código con cambios en la estructura de la interfaz de usuario (nuevos elementos, reorganización de pantallas, cambios en el flujo de navegación), la app móvil instalada sigue mostrando la versión anterior y no refleja las modificaciones.

### Causa

Cuando se instala una PWA como aplicación standalone en Android, el navegador Chrome cachea agresivamente los recursos de la interfaz. Para cambios **estructurales** importantes (no solo contenido del bundle cifrado), puede ser necesario limpiar completamente el almacenamiento de la aplicación.

### Atajo — botón en la app (probá esto primero)

Desde la versión con `initMaintenance()`, la propia app tiene un botón que hace
exactamente lo mismo que las opciones A/B/C de más abajo, sin salir de la app:
**Ajustes → Mantenimiento ▾ → "Vaciar caché y reiniciar"**. Pide confirmación
porque también borra el corpus desbloqueado (vas a re-ingresar la CLAVE_DESPLIEGUE)
y las credenciales de Telegram guardadas sin PIN. Si el botón no está disponible
(versión vieja de la app, todavía sin este parche) o no resuelve el problema,
seguí con las opciones manuales de abajo.

### Cuándo aplicar esta solución

**Aplica cuando:**
- Agregaste nuevas pantallas o secciones a la app
- Cambiaste el flujo de navegación o la estructura de menús
- Modificaste elementos de la interfaz (botones, formularios, layout)
- Actualizaste CSS que afecta la estructura visual
- La app sigue mostrando elementos viejos a pesar de haber actualizado el Service Worker

**No es necesario para:**
- Cambios solo en el contenido de tangos (el bundle cifrado se actualiza automáticamente)
- Correcciones menores de texto o colores
- Actualizaciones del manifest.json o íconos (estas se actualizan automáticamente)

### Solución paso a paso

#### Opción A - Limpiar almacenamiento desde la configuración de Chrome

1. **Abrir la información del sitio:**
   - Chrome ⋮ (menú) → ⓘ Información del sitio

2. **Acceder al almacenamiento:**
   - Permisos y almacenamiento → "Administrar espacio" o "Storage settings"

3. **Borrar todo el almacenamiento:**
   - "Borrar almacenamiento" → "Borrar"
   - Confirmar la acción

4. **Cerrar y reabrir la app:**
   - Cerrar completamente Chrome o la app standalone
   - Volver a abrir desde el ícono del escritorio

#### Opción B - Limpiar desde configuración de Android (para app instalada)

1. **Ir a configuración de aplicaciones:**
   - Android Settings → Apps → buscar "Tango" o el nombre de tu app

2. **Limpiar datos de la aplicación:**
   - Storage & cache → "Clear storage" o "Borrar almacenamiento"
   - También: "Clear cache" → "Borrar caché"

3. **Reiniciar la aplicación:**
   - Abrir la app desde el ícono del escritorio
   - La app solicitará nuevamente la `CLAVE_DESPLIEGUE`

#### Opción C - Desinstalar y reinstalar (última opción)

Si las opciones anteriores no funcionan:

1. **Desinstalar la PWA:**
   - Mantener presionado el ícono de la app → "Desinstalar" o "Remove"

2. **Limpiar datos del navegador (opcional):**
   - Chrome → Settings → Privacy and security → Clear browsing data
   - Seleccionar "Cached images and files" y "Site settings"

3. **Reinstalar desde el navegador:**
   - Abrir `https://misbusquedaspersonales-cyber.github.io/tango_cipher_bot_public/`
   - Chrome ⋮ → "Instalar app"

### Verificación

Después de limpiar el almacenamiento:

1. **La app debe solicitar la `CLAVE_DESPLIEGUE` nuevamente** (esto confirma que se borró el almacenamiento local)

2. **Los cambios estructurales deben ser visibles** después del primer desbloqueo

3. **El Service Worker se descarga nuevamente** (puedes verificar en Chrome DevTools → Application → Service Workers)

### Cuándo contactar soporte técnico

Si después de seguir todos los pasos la app sigue mostrando la interfaz anterior:

1. **Verifica que el deploy fue exitoso:**
   ```bash
   curl -I https://misbusquedaspersonales-cyber.github.io/tango_cipher_bot_public/pwa/index.html
   ```

2. **Confirma la fecha del último deploy en GitHub:**
   - Ve a Settings → Pages en el repositorio público
   - Verifica que dice "published" con fecha reciente

3. **Prueba desde un dispositivo diferente** para descartar problemas específicos del teléfono

