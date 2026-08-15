# Tango Cifrado — Sistema de Cifrado Híbrido

> ## ⚠️ VERSIÓN ABANDONADA
>
> Este repositorio está archivado y no recibe mantenimiento.
>
> La migración de Telegram a Cloudflare se realizó de forma incremental sobre una base que ya cargaba demasiado peso del diseño anterior. El resultado es una implementación híbrida que mantiene las prácticas de Telegram (transporte, formato de mensajes, flujo de autenticación) mientras intenta añadir encima una capa TCMP/Cloudflare — lo que produce dos sistemas parciales en lugar de uno completo. Las abstracciones necesarias para hacer esa transición limpia (identidad de dispositivo, inbox propio, adjuntos cifrados de punta a punta) estaban bocetadas pero nunca llegaron a una implementación básica funcional de extremo a extremo.
>
> La conclusión es que una reescritura desde cero, diseñando primero el protocolo sin el legado de Telegram, producirá un resultado más sólido y más fácil de auditar que continuar parcheando esta versión.
>
> El código se conserva como referencia histórica y como fuente de decisiones de diseño documentadas (ver `ROADMAP.md`, `TCMP_V1.md`, `TO_FIX.md`). No usar en producción.

## Arquitectura

**TCMP (Tango Cryptographic Messaging Protocol) v2** es el flujo principal que combina:
- **Cifrado por libro** basado en corpus privado de letras de tango (`tangos.json`)
- **Criptografía moderna**: P-256 ECDH + ECDSA + HKDF + AES-256-GCM para sesiones
- **Transporte Cloudflare**: D1 para mensajes + R2 para adjuntos
- **Compatibilidad legacy**: mantiene soporte completo para Telegram

### Flujos de Comunicación

**🚀 Flujo Principal (TCMP/Cloudflare)**:
- Texto → TCMP → Tango keyed codec → Cloudflare D1 → Receptor
- Texto enriquecido → JSON document → TCMP → Cloudflare
- Adjuntos → AES-GCM chunks → Cloudflare R2 + metadata cifrada en D1
- Recepción → polling cada 5s, verificación y descifrado antes de eliminar

**📱 Flujo Legacy (Telegram)** — mantenido para compatibilidad:
- Los ciphertexts largos (>1200 chars) se envían como archivos `.txt` adjuntos
- La pestaña "Descifrar" sigue permitiendo descifrar códigos antiguos
- Transporte Telegram disponible como fallback durante la migración

### Codec Tango (común a ambos flujos)
Cada palabra se codifica como coordenada `V[verso]P[palabra]` dentro del tango elegido. El ID del tango se enmascara sumando un SALT. Palabras fuera del corpus usan XOR SALT en hexadecimal (`#hex`). La puntuación, espacios y mayúsculas se preservan exactamente — el round-trip es lossless.

**⚠️ Advertencia Criptográfica**: La implementación de sesión actual es una base funcional de migración usando P-256 ECDH + ECDSA + HKDF + AES-256-GCM. **No debe presentarse como equivalente a un protocolo Double Ratchet auditado**. La interfaz está aislada para permitir sustitución futura sin rediseñar la PWA, Cloudflare, Tango codec, texto enriquecido o sistema de adjuntos.

**PWA en Vivo:** [tango_cipher_bot_public/pwa](https://misbusquedaspersonales-cyber.github.io/tango_cipher_bot_public/pwa/index.html)

### URLs cortas y atajos de acceso

La PWA se publica en GitHub Pages en una ruta un poco larga. Para no tener que escribirla
completa cada vez, hay varias alternativas:

#### 🔗 URLs cortas (funcionan una vez que se deployaron los redirects del root)

En la raíz del repo hay dos archivos (`index.html` y `go.html`) que redirigen
automáticamente a `/pwa/index.html`. Si esos archivos están pusheados a `main` y GitHub
Pages ya los publicó, podés usar directamente:

| URL corta | Redirige a |
|---|---|
| `https://misbusquedaspersonales-cyber.github.io/tango_cipher_bot_public/` | `/pwa/index.html` |
| `https://misbusquedaspersonales-cyber.github.io/tango_cipher_bot_public/go.html` | `/pwa/index.html` |

Si entrás a la URL raíz y GitHub Pages muestra 404, es porque los redirects del root
todavía no están pusheados (son `untracked`). Subilos así:

```bash
git add index.html go.html pwa/go.html
git commit -m "feat: root redirects for short GitHub Pages URLs"
git push origin main
```

Esperá ~1 minuto a que GitHub Pages termine el deploy y listo.

#### 📱 Bookmark / "Add to Home Screen" (sin escribir URLs nunca más)

Esta opción no requiere código ni comandos:

- **Desktop:** Abrí la PWA en tu navegador → `Ctrl+D` (`Cmd+D` en macOS) y guardala en la barra de bookmarks. Un click y ya está.
- **Android (Chrome):** Abrí la PWA → menú ⋮ → **"Instalar app"** / **"Agregar a pantalla de inicio"**. Queda un ícono nativo en el launcher.
- **iPhone (Safari):** Abrí la PWA → botón compartir (⬆️ en caja) → **"Agregar a pantalla de inicio"**. Misma experiencia que una app nativa.

#### 💻 Aliases de shell (comandos de terminal)

En `scripts/aliases/` hay tres comandos ejecutables listos para usar. Agregalos a tu `$PATH`
agregando esta línea al final de tu `~/.bashrc`, `~/.zshrc` o `~/.profile`:

```bash
export PATH="/ruta/al/repo/scripts/aliases:$PATH"
```

Reabrí tu terminal (o corré `source ~/.bashrc`) y ya podés usar:

| Comando | Qué hace |
|---|---|
| `tango` | Abre la PWA en tu navegador predeterminado (usa `xdg-open` en Linux, `open` en macOS, `start` en Windows). |
| `tango --short` o `tango -s` | Abre la URL corta (raíz del Pages) en vez de la ruta larga a `/pwa/index.html`. |
| `tango-url` | Imprime la URL completa por salida estándar y la copia automáticamente al clipboard si detecta `xclip`, `wl-copy` o `pbcopy`. Ideal para pegar en chats, mails, notas. |
| `tango-url --short` o `tango-url -s` | Lo mismo pero imprime/copia la URL corta. |
| `tango-cli` | Corré el CLI local (`python3 main.py`) desde cualquier carpeta, activando automáticamente el `venv` del proyecto si existe. |

Ejemplo de uso rápido:

```
$ tango-url
Tango Cifrado URL (full):
  https://misbusquedaspersonales-cyber.github.io/tango_cipher_bot_public/pwa/index.html
  (copiado al clipboard con xclip)

$ tango
✅ Abriendo Tango Cifrado → https://misbusquedaspersonales-cyber.github.io/tango_cipher_bot_public/pwa/index.html
```

```
[ Repo privado ]  →  [ setup_private_core.sh / CI ]  →  [ Repo público / GitHub Pages ]
  tangos.json           AES-256-GCM (build bundle)           encrypted-bundle.json
  SALT secreto          PBKDF2-HMAC-SHA256                   PWA estática
  código fuente         CLAVE_DESPLIEGUE

[ PWA ]  →  [ TCMP / Cloudflare Worker ]  →  [ Receptor ]
  mensajes/adjuntos      D1 (mensajes cifrados)                polling cada 5s
  identidad ECDH/ECDSA   R2 (adjuntos AES-GCM)                 descifrado local
```

## Estructura del Proyecto

| Archivo / Carpeta | Descripción |
|---|---|
| `tangos.json` | Corpus de tangos. Versos de relleno técnico marcados con `"padding": true`. |
| `src/tango_cifrado/corpus.py` | Único adaptador sobre `private_core.cipher_engine` — el único archivo del repo público que importa del módulo vendored. Todos los demás módulos Python importan desde aquí. |
| `src/tango_cifrado/telegram.py` | Implementación del envío a Telegram (movida desde `telegram_client.py`). |
| `src/tango_cifrado/cli.py` | Lógica del CLI interactivo (movida desde `main.py`). |
| `main.py` | Shim de entrada: ajusta `sys.path` y delega a `tango_cifrado.cli`. |
| `telegram_client.py` | Shim de re-exportación: mantiene compatibilidad hacia atrás para tests y callers externos. |
| `secure-vault.js` | Gestión de credenciales en el browser (Layer 1: bundle deploy, Layer 2: PIN opcional, flujo sin fricción por defecto). |
| `scripts/ci/build_encrypted_bundle.py` | Copia de referencia del script homónimo del repo privado. Usada por `tests/python/test_build_encrypted_bundle.py`. **No corre en CI** — la versión activa en producción vive en el repo privado en `scripts/build_encrypted_bundle.py`. Mantenerlas en sincronía a mano. |
| `scripts/ci/decrypt_bundle_cli.py` | Ídem — copia de referencia local. La versión activa está en el repo privado. |
| `scripts/dev/setup_private_core.sh` | Configura el entorno local clonando el repo privado en un estado "vendored" (pinneado a un commit SHA). |
| `scripts/aliases/` | Comandos cortos de terminal: `tango` (abrir PWA), `tango-url` (copiar URL al clipboard), `tango-cli` (wrapper del CLI local). |
| `scripts/apk/` | Scripts helpers del flujo TWA / APK (Fase 9): `install-deps.sh` (Node20 + JDK17 + Bubblewrap con detección root/sudo), `generate-keystore.sh` (RSA-2048 con chequeo de passwords comprometidos + modo CI), `generate-assetlinks.sh` (SHA256 de keystore → escribe assetlinks.json en AMBAS carpetas `.well-known/` y `pwa/.well-known/`), `build-apk.sh` (wrapper idempotente de `bubblewrap build` con `--ignore-scripts` + auto-init si falta `twa-manifest.json` + **auto-sync de share_target** + **version verification**), `sync-share-target.sh` (sincroniza `pwa/manifest.json` share_target → `twa-manifest.json` shareTarget automáticamente, corriendo `bubblewrap update` cuando sea necesario). |
| `tango-cifrado-apk/` | Proyecto wrapper Android TWA (Trusted Web Activity). Contiene `twa-config.json` (defaults de Bubblewrap), `.gitignore` (incluye `strings.xml` + `colors.xml` como stubs — ver TO_FIX M-2), README con lifecycle de actualizaciones y flujo rápido. `twa-manifest.json` y `android.keystore` son **no versionables** (generados por `bubblewrap init` y `generate-keystore.sh` respectivamente). **Web Share Target**: ⚠️ **Limitación conocida** — Web Share Target causa fallos de instalación en ciertos dispositivos Android. APK recomendada sin esta funcionalidad (`tango-cifrado-NO-SHARE-TARGET.apk`) instala correctamente. `twa-manifest.json` puede configurarse con/sin `shareTarget` según compatibilidad del dispositivo objetivo. `sync-share-target.sh` se ejecuta automáticamente en cada build para mantener sincronización cuando está habilitado. **Version Sync**: builds limpios pueden desincronizar versiones Android (ver TO_FIX M-4). APK final se sube a GitHub Releases desde el CI. |
| `NEXTPASOS_APK.md` | Checklist 6-pasos para build local del APK (publish assetlinks → verificación Google → `build-apk.sh` → sideload → config de 4 secrets CI). Referencia rápida del flujo TWA completo. **Superseded por `APK_BUILD.md`.** |
| `.github/workflows/build-twa-apk.yml` | GitHub Actions de Fase 9.3 — APK automático en cada `workflow_dispatch` o push de tags `apk/v*`. Triggers: secret guard → Temurin JDK17 → Node20 → Bubblewrap `--ignore-scripts` → Android SDK 11076708 → rebuild keystore desde base64 secret → `bubblewrap init` si falta `twa-manifest.json` → `bubblewrap build` con bypass de TODOS los prompts interactivos → **Smoke-test APK strings (M-2 guard)** (aapt2 dump: `hostName`/`launchUrl`/`colorPrimary` no vacíos ni stubs) → upload artifact 30 días → GitHub Release assets → `always()` wipe keystore. |
| `.github/workflows/build-encrypted-bundle.yml` | GitHub Actions workflow de build (solo en el repo privado). |
| `.github/workflows/drift-check.yml` | GitHub Actions workflow semanal: compara el `PRIVATE_CORE_COMMIT` pinneado contra el HEAD del repo privado y abre Issue automático si detecta drift. Requiere el secreto `PRIVATE_REPO_PAT`. |
| `tests/` | 64 tests always-runnable (60 JS + 4 TCMP protocol), plus 43 Python requiring `private_core/`. JS breakdown: `cipherEngine.test.mjs` 27 (16 fixed + 11 shared-vector loop), `pwa_e2e.test.mjs` 6, `transport.test.mjs` 27 (transport layer + receive + invariant + TokenOverflowError), `pwa/core/tcmp/protocol.test.mjs` 4 (Tango codec roundtrip, message roundtrip, tampering, attachment byte roundtrip). Python always-runnable: `test_build_encrypted_bundle.py` 5 + `test_telegram_client.py` 9. Python requiring `private_core/`: `test_cipher_engine.py` 32 + 11 shared vectors. Run `python3 -m pytest tests/python/ -v` and `npm test` separately. |

## Setup del CLI (desarrollo / pruebas)

Antes de trabajar con commits locales, activa la guardia de seguridad para evitar filtrar el corpus privado:

```bash
git config core.hooksPath hooks
```

```bash
python3 -m venv venv
source venv/bin/activate
pip install requests python-dotenv cryptography pytest
cp .env.example .env
# editar .env con tu TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID
# ver TROUBLESHOOTING.md si no tienes el CHAT_ID
python3 main.py
```

## Configuración del Bot de Telegram

1. Abre Telegram y busca **@BotFather**.
2. Envía `/newbot` y sigue las instrucciones.
3. Copia el TOKEN HTTP API.
4. Envíale `/start` a tu nuevo bot.
5. Obtén tu `CHAT_ID` — ver `TROUBLESHOOTING.md`.
6. Completa `.env`:
   ```
   TELEGRAM_BOT_TOKEN=<tu_token>
   TELEGRAM_CHAT_ID=<tu_chat_id>
   ```

## Uso del CLI

```
python3 main.py
```

El script solicita la clave del tango (número del 1 al 7) y el mensaje. Cifra, envía a Telegram y muestra el descifrado local como verificación.

## Correr los tests

```bash
python3 -m pytest tests/python/ -v
```

### Verificar integridad de assets de la PWA

`scripts/dev/check_pwa_assets.py` valida en dos direcciones cualquier cambio en `pwa/`:

1. **FORWARD** — toda referencia en `manifest.json` (íconos), `index.html` (`@font-face`, `<link>`, `<img src>`) y `service-worker.js` (`SHELL_FILES`) apunta a un archivo que realmente existe en disco.
2. **REVERSE** — todo `.ttf`/`.png` dentro de `pwa/fonts/` y `pwa/icons/` está referenciado por al menos uno de esos tres archivos (evita publicar fonts/icons muertos que nadie usa pero se siguen subiendo a GitHub Pages).

Correrlo antes de cualquier PR que toque `pwa/`:

```bash
python3 scripts/dev/check_pwa_assets.py
```

## Probar la PWA instalada en un celular real

Ver `MOBILE_TESTING.md` para el checklist completo. Dos caminos principales:

### Opción recomendada: APK real (sideload)

Compila e instala el APK firmado — este es el binario que usarán los destinatarios reales:

```bash
cd tango-cifrado-apk
../scripts/apk/build-apk.sh
# Pasar dist/apk/app-release-signed.apk al teléfono e instalar
```

**Web Share Target**: ⚠️ deshabilitado en el APK actual — ver "Limitación conocida" más arriba y `TO_FIX.md` M-5. El script `sync-share-target.sh` corre en cada build pero, desde el fix de M-5, ya no reactiva `shareTarget` automáticamente aunque la PWA lo tenga (evita reintroducir el bug de instalación en silencio). Para compilar la variante experimental con Share Target y ayudar a diagnosticar la causa raíz: `ALLOW_SHARE_TARGET=1 ../scripts/apk/build-apk.sh`.

### Opción alternativa: PWA vía Chrome  

Para desarrollo rápido (USB port-forwarding con `chrome://inspect`, camino de producción por HTTPS). **Nota**: algunas funcionalidades nativas como Web Share Target requieren el APK real para validación completa.

## Seguridad — notas importantes

- `DEFAULT_SALT = 47` en `cipher_engine.py` es un placeholder de desarrollo. En producción el SALT se inyecta como secreto de GitHub Actions (`CIFRADO_SALT`) y nunca aparece en el código público.
- La seguridad del sistema depende de mantener `tangos.json` y el SALT fuera del repo público. El pipeline de CI se encarga de esto.
- Ver `ROADMAP.md` para el estado de cada fase del proyecto.

## Secretos de GitHub Actions (CI/CD)

Para que los pipelines funcionen correctamente, el repositorio público debe tener configurados los siguientes secretos
(**Settings → Secrets and variables → Actions → New repository secret**):

| Secreto | ¿Obligatorio? | Descripción |
|---|---|---|
| `CIFRADO_SALT` | Obligatorio — **repo privado** (`build-encrypted-bundle.yml`) | Valor numérico secreto usado para enmascarar los IDs de tango. **No** es el KDF salt de PBKDF2, es el offset numérico que se suma al ID del tango antes de escribirlo en el ciphertext. |
| `CLAVE_DESPLIEGUE` | Obligatorio — **repo privado** (`build-encrypted-bundle.yml`) | Contraseña maestra de alta entropía para AES-256-GCM que desencripta el corpus y el SALT en la PWA. Usá `openssl rand -base64 32`, no una frase memorizable. |
| `PUBLIC_REPO_DEPLOY_TOKEN` | Obligatorio — **repo privado** (`build-encrypted-bundle.yml`, job `deploy-to-public-repo`) | Personal Access Token con permiso **Contents: write** sobre el repo público (`tango_cipher_bot_public`). El job lo usa para hacer push del bundle cifrado hacia el repo público después de cada build. En `.env` local este token se guarda bajo la clave `tango-bundle-public-deployer`. |
| `PRIVATE_REPO_PAT` | Obligatorio — **repo público** (`drift-check.yml`) | Personal Access Token con permisos de **lectura** sobre el repo privado (`tango_corpus_private`). Sin este secreto el workflow semanal no puede consultar el SHA remoto y falla. Se configura en el **repo público** (donde corre `drift-check.yml`), no en el privado. |

> ⚠️ Importante: no embebas tokens en la URL remota de git (`https://<token>@github.com/...`). Esto puede exponer tu PAT en la configuración local. Usa una URL limpia y un helper de credenciales en su lugar. Ver `TROUBLESHOOTING.md` para más detalles sobre este problema.

