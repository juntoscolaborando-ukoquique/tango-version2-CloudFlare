# TO_FIX — Pending Tasks

## Progress Summary

| Priority | Total | Done ✅ | Parcial 🔄 | Pendiente ❌ |
|---|---|---|---|---|
| 🟢 P3 (Low) | 1 | 0 | 1 | 0 |
| 🔵 P4 (Refactor) | 1 | 1 | 0 | 0 |
| 🔧 Maintenance | 7 | 3 | 3 | 1 |
| 🔧 Chunking edge cases | 2 | 2 | 0 | 0 |
| **Total** | **11** | **6** | **4** | **1** |

> Auditoría 2026-08-13: se verificó código-fuente por cada item (ver § abajo). La tabla anterior refleja el estado REAL. El primer borrador mentía (decía 0 done pero 3 checkeados, y M-3/C-1/C-2 estaban documentados como bloqueados cuando ya tenían code fixes).
> Añadido 2026-08-15: M-7 (Diagnóstico APK Parse Package persistente) — plan de debugging estructurado; SIN EJECUTAR todavía, a espera de confirmación del usuario.

---

## 🟢 P3 — LOW

### [ ] P3-5: Frequency Analysis on Reused Coordinates (Book Cipher Nature)

- **PARCIALMENTE RESUELTO 🔄 — mitigaciones de código listas; queda la expansión de corpus (Fase 2).**
- **Limitación arquitectónica inherente**: por ser un "book cipher", reutilizar la misma clave de tango para muchos mensajes filtra patrones de frecuencia por palabra, frases repetidas y longitud exacta del mensaje en tokens.
- **Mitigaciones YA IMPLEMENTADAS en código** (confirmado audit 2026-08-13):
  1. ✅ Selección aleatoria de verso: cuando una palabra aparece en múltiples versos del mismo tango, el cifrador elige un verso/par al azar en vez de la primera coincidencia. [cipherEngine.js:117-135](file:///root/JOB-sda2/CIFRADO-TANGOS/Tango/pwa/cipherEngine.js#L117-L135) y `private_core/cipher_engine.py:191-201`. Retrocompatible.
  2. ✅ Fallback keystream context-bound: evita reutilización two-time-pad entre mensajes (anteriormente P1-4).
- **Queda pendiente**:
  - Fase 2 — llegar a 20+ tangos para que el ID del tango solo no sea un predictor fuerte de tono/registro. **Estado corpus actual (auditado 2026-08-13): 8 tangos.** (Tango 8 *El Mensajero* ya está incorporado y propagado a Pages + APKs nuevas.)

---

## 🔵 P4 — REFACTOR (Structure / Maintainability)

### [x] P4-2: `app.js` Mixes Three Distinct Concerns in One 500+ Line File

- **✅ RESUELTO (parcialmente, por Fase 10.1.1)** — auditado 2026-08-13.
- **Hecho**: `pwa/core/transport/` + `pwa/core/receive/` extraídos de `app.js`. El corte grande está cerrado.
- **Pendiente (postergado a Fase 10.2, no bloqueante)**: glue solo-DOM (cambio de pantallas, handlers de formularios → `ui/composer.js`).

---

## 🔧 Maintenance

### [ ] M-5: Web Share Target intent-filters cause APK installation failure

- **🔄 DESCUBIERTO Y MITIGADO** — session 6 round 7: la causa raíz de los fallos de instalación de APK identificada.
- **Problema**: APKs con Web Share Target (`shareTarget` en `twa-manifest.json`) generan intent-filters `android.intent.action.SEND` + `SEND_MULTIPLE` que causan fallos de instalación en ciertos dispositivos Android.
- **Evidencia comparativa**:
  - ✅ APK sin Web Share Target (versionCode=2, old working): instalación exitosa
  - ❌ APK con Web Share Target (versionCode=6, recent): fallo de instalación  
  - ✅ APK sin Web Share Target (versionCode=7, test): instalación exitosa
- **Root cause verificado**: Al comparar con versión working anterior, el único cambio significativo fueron los intent-filters de Web Share Target en AndroidManifest.xml
- **Posibles causas técnicas**:
  - Incompatibilidad de versión Android del dispositivo con Web Share Target TWA
  - Error de configuración en intent-filters generados por Bubblewrap
  - Conflicto TWA + Web Share Target en el sistema de intents Android
- **Mitigación actual**: APK compilado sin `shareTarget` (`tango-cifrado-NO-SHARE-TARGET.apk`) instala correctamente
- **Estado**: **Funcional básico** (APK instala), **Web Share Target bloqueado** (requiere investigación adicional)
- **Próximos pasos**: 
  1. **Capturar el dato que falta**: la investigación actual comparó dos APKs (con/sin `shareTarget`) pero nunca miró `adb logcat` en el momento exacto de la instalación fallida. Sin ese log, "causa raíz verificada" en realidad significa "correlación verificada, causa desconocida". Repetir la instalación del APK CON `shareTarget` en un dispositivo que falla, con `adb logcat | grep -i "PackageParser\|parseBaseApk"` corriendo en paralelo, es el primer paso — probablemente el único que realmente acota las 3 hipótesis de abajo a una.
  2. Probar intent-filter alternativo o configuración Bubblewrap (versión de `@bubblewrap/cli` distinta — la actual coincide con la que introdujo `compileSdkVersion 36`; podría ser el mismo tipo de drift de versión que causó M-4, no un problema de Web Share Target en sí).
  3. Probar en un tercer dispositivo/versión de Android distinto a los dos usados en la comparación original — con solo 2 dispositivos no se puede distinguir "todos los Android fallan" de "este modelo/versión puntual falla".
  4. Considerar APK dual: básico (sin share target) + experimental (con share target), para no bloquear la distribución mientras se investiga.

#### ¿Por qué vale la pena reintentarlo, y no dejarlo como estaba?

El workaround actual (`tango-cifrado-NO-SHARE-TARGET.apk`) no es gratis — devuelve al receptor exactamente al flujo manual que Fase 10.1.1 se propuso eliminar:

- **La razón por la que existe `sendDocument`/Web Share Target en primer lugar**: los mensajes cifrados largos (>1200 chars) se mandan como archivo `.txt` adjunto porque el deep-link de texto no entra en el límite de Telegram. Sin Share Target, el receptor tiene que: guardar el archivo manualmente desde Telegram, abrir la app aparte, tocar "Abrir archivo cifrado", y buscar el archivo en el almacenamiento — cuatro pasos manuales en vez de un tap en "Compartir". Para un destinatario no técnico (el caso de uso real de esta app), cada paso manual es una oportunidad de error o de abandono.
- **Es la única pieza de la Fase 10.1.1 que quedó a medio camino.** Todo el resto — `sendDocument`, `selectTransport`, el pipeline de recepción, el fallback manual — está implementado, probado (53/53 JS) y funcionando en producción. Web Share Target es la última pieza para que el flujo completo sea "un tap" de punta a punta, tal como está descripto en el propio `ROADMAP.md` y `README.md`.
- **El fallback manual seguirá existiendo aunque se resuelva esto** — no hay riesgo de regresión al reintentar: si Web Share Target vuelve a fallar, el peor caso es quedar exactamente donde está hoy.
- **La causa raíz sigue sin identificarse**, lo cual es distinto de "confirmado incompatible". Es enteramente posible que el problema no sea Web Share Target en sí, sino un artefacto del mismo tipo de drift de configuración que ya causó M-4 (versión de Bubblewrap/SDK no pineada, generando intent-filters o metadata inconsistente entre builds). Si ese es el caso, la solución podría ser tan simple como pinear la versión de `@bubblewrap/cli` — no un problema arquitectónico de fondo.

### [ ] M-4: APK version desynchronization on clean builds

- **🔄 PARCIALMENTE RESUELTO** — fix manual aplicado (session 6 round 7), pero queda brecha de automatización.
- **Problema**: Cuando falta `./gradlew` (CI, clean checkout), `build-apk.sh` dispara `bubblewrap init --manifest $URL`, que:
  1. Lee PWA `manifest.json` (carece de campos version Android-específicos)  
  2. Sobrescribe `twa-manifest.json` existente con defaults: versionCode=1, versionName="", targetSdkVersion=latest
  3. Ignora valores configurados: versionCode=4, versionName="1.3.0", targetSdkVersion=34
- **Estado actual**:
  - ✅ Fix manual aplicado: `app/build.gradle` sincronizado manualmente con valores `twa-manifest.json`
  - ✅ APK verificado: APK final tiene versionCode='4', versionName='1.3.0' correcto
  - ❌ Brecha identificada: `build-apk.sh` solo **detecta** `twa-manifest.json` faltante, no **verifica/corrige** sync de versiones
- **Brecha de automatización**: El script dice tener "version synchronization guards" pero solo corre:
  ```bash
  bubblewrap init --manifest="$URL"  # Sobrescribe versiones con defaults
  sync-share-target.sh              # Sincroniza share_target, NO versiones
  ```
- **Riesgo de próxima ocurrencia**: **Alto** — cualquier build limpio (CI sin cache `./gradlew`, clone fresco) disparará la misma desincronización
- **Opciones de solución**:
  1. **Version sync en build-apk.sh** — después de `bubblewrap init`, leer versiones `twa-manifest.json` y patchear `app/build.gradle`
  2. **Init guard** — detectar cuando `bubblewrap init` va a sobrescribir versiones, backup/restore
  3. **CI persistence** — asegurar que CI cachee `./gradlew` para evitar trigger del path `init`
- **Prioridad**: **Media** — no bloquea distribución actual, pero causará confusión en próximo build limpio

### [x] M-3: CI APK build fails with bubblewrap interactive prompts — complex multi-stage issue

- **✅ RESUELTO (todos los prompts + sintaxis YAML). Auditado 2026-08-13 en [build-twa-apk.yml](file:///root/JOB-sda2/CIFRADO-TANGOS/Tango/.github/workflows/build-twa-apk.yml).**
- **Status final**: Workflow parsea correctamente. Ningún step de bubblewrap depende de stdin interactivo. Queda **pendiente la PRIMERA ejecución end-to-end real en el runner de GitHub Actions** (requiere ~5 GB libres durante el download del SDK + Gradle daemon). El workflow ya no falla por problemas de código/YAML.
- **Fixes ya aplicados y confirmados en workflow**:
  1. ✅ npm install con `--ignore-scripts` (skipea prompt JDK del postinstall) → línea ~115.
  2. ✅ Pre-creación de `~/.bubblewrap/config.json` con jdkPath + androidSdkPath → skipea prompts de init/bubblewrap setup.
  3. ✅ SDK symlink `tools -> cmdline-tools/latest` para compatibilidad bubblewrap.
  4. ✅ Env vars `BUBBLEWRAP_KEYSTORE_PASSWORD` + `BUBBLEWRAP_KEY_PASSWORD` (no prompts de keystore).
  5. ✅ `printf 'n\n' | bubblewrap build --skipPwaValidation` (no prompt de regeneración).
  6. ✅ **Fix de sintaxis YAML anterior** (expresiones `${{ ... }}` no citadas con bash `&&`/`||` inline — movido a bloques `run:` planos con `if [ -n … ]` en bash).
  7. ✅ Si falta `./gradlew` → corre `{ printf 'Y\nY\n'; } | bubblewrap init --manifest $MANIFEST_URL` automáticamente con log fallback.
- **Evidencia adicional (CHANGELOG Unreleased 2026-08-13 session 6 round 2)**: documenta M-3 como fixed, y el step `Smoke-test APK strings (M-2 guard)` del workflow (líneas 303-363) sí existe.
- **Workaround manual** mientras se valida el CI build: `cd tango-cifrado-apk && ../scripts/apk/build-apk.sh` — funciona y produce APKs válidas.

### [x] M-6: Cache clearing procedure complex and error-prone for users

- **✅ RESUELTO** — patches 0009-0012 applied (session 6 round 8): automated cache clearing feature.
- **Problema original**: Manual cache clearing via TROUBLESHOOTING.md requería múltiples pasos técnicos propensos a error: desregistrar Service Worker, borrar Cache Storage, borrar IndexedDB, limpiar localStorage, hard refresh. Usuarios no técnicos frecuentemente cometían errores o abandonaban el proceso.
- **Solución implementada**: 
  - **UI integrada**: Botón "Mantenimiento ▾ → Vaciar caché y reiniciar" en settings de la app
  - **Automatización completa**: `clearAllLocalStateAndReload()` ejecuta todos los pasos de limpieza automáticamente
  - **Seguridad de datos**: Diálogo de confirmación advierte sobre pérdida de corpus desbloqueado y credenciales Telegram
  - **Manejo robusto**: Continúa proceso aún si algunos pasos fallan, evitando estados parciales
- **Resultado**: Procedimiento de 6 pasos manuales reducido a 2 clicks (botón + confirmación). Soporte técnico significativamente reducido.
- **Fallback preservado**: TROUBLESHOOTING.md mantiene pasos manuales para versiones anteriores y casos edge.

### [ ] M-7: APK installation persistent "There was a problem parsing the package" — root-cause diagnosis

- **🔄 PARCIALMENTE RESUELTO (correlaciones identificadas; causa raíz aún desconocida).** Reportado 2026-08-14 por usuario en móvil al enviar APK por Telegram.
- **⚠️ IMPORTANTE: Este plan está documentado pero NO EJECUTADO todavía. Se ejecutará solo tras confirmación del usuario por los impactos que implica (reinstalaciones, regeneración de keystore opcional, etc.).**
- **Síntoma reportada**: Al enviar `app-release-signed.apk` (versionCode=4 y versionCode=5, ambos SDK 36 build, firmas v1+v2+v3 OK localmente) vía Telegram y descargarlo en móvil, Android muestra "There was a problem parsing the package" sin detalle. El error ocurre incluso con el APK validado localmente (apksigner verify → 3 firmas OK, ZIP integrity OK, metadata aapt2 dump OK).
- **Evidencia LOCAL obtenida (2026-08-14, 2026-08-15) pero aún no confirmada en el dispositivo**:
  1. ✅ APK `dist/apk/app-release-signed.apk` versionCode=4 (SHA-256: `17cfc7d2de98…`) — estructura válida, firmas OK.
  2. ✅ APK `dist/apk/app-release-signed.apk` versionCode=5 rebuild (SHA-256: `0ad0c9a4d45d…`) — idem, structure válida.
  3. ✅ AndroidManifest.xml no contiene `intent-filter` `action.SEND` / `action.SEND_MULTIPLE` — guardia M-5 `ALLOW_SHARE_TARGET=0` funcionando.
  4. ✅ `minSdk=21`, `targetSdk=34`, `compileSdk=36`; `package=com.tangocifrado.app`; `versionName=1.3.0` / `1.3.1`.
  5. ✅ SHA-256 coincidente entre build 1 y build 2 para versionCode=4 (build era idempotente).
- **Hipótesis actuales, ORDENADAS por probabilidad (alta a baja)**:
  1. 🟥 **H1 — Telegram corruption (90% prob.)**: Telegram server-side re-encodes/re-packages `.apk` attachments al subirlos o al servirlos (cambia la compresión del APK ZIP, agrega headers, trunca el `APK Signing Block` v2/v3 que está después del EOCD del ZIP, o reemplaza bytes). Resultado: `apksigner verify` del APK original es OK, pero el APK que Android recibe después de Telegram ≠ el original. Esto es **muy común** con `content://` URIs de Telegram.
     - Prueba refutación: instalar el MISMO APK vía `adb install -r` — si funciona, H1 es confirmada 100% (el APK está bien; Telegram lo corrompe).
  2. 🟧 **H2 — Residual TWA state / signature mismatch (60% prob.)**: En algún momento se instaló una build de Tango Cifrado con **firma diferente** (debug keystore, otro keystore accidental, o install desde Play Store/AppGallery de prueba) y la desinstalación normal NO borró la asociación Trusted Web Activity del sistema (PackageManager mantiene entries residuales en `/data/system/packages.xml` + Chrome mantiene associations TWA en su sandbox). Al intentar instalar un APK con el mismo `applicationId="com.tangocifrado.app"` pero firma hash distinta, Android rechaza SILENCIOSAMENTE y muestra el error ambiguo de "parsing the package" en vez de "INSTALL_FAILED_UPDATE_INCOMPATIBLE: Package signatures do not match previously installed version".
     - Prueba refutación: `adb install -r app-release-signed.apk` — si devuelve `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, H2 es confirmada.
  3. 🟨 **H3 — compileSdkVersion=36 (Android 16 preview) drift (15% prob.)**: El APK compila con `compileSdkVersion=36` (`platformBuildVersionCode='36'`, `compileSdkVersionCodename='16'`). Algunos PackageManager antiguos (Android 7.x / 8.x / 9.x / custom ROMs Xiaomi MIUI / Huawei EMUI pre-2022) tienen bugs conocidos al parsear `AndroidManifest.xml` cuando `compileSdkVersion` es un código preview no finalizado (codename != REL). El `package-parser.jar` de estos sistemas usa checkeos estrictos sobre `platformBuildVersionName` y se niega a parsear el manifest. Esto explicaría por qué en algunas builds del mismo teléfono sí y en otras no (fOTA actualizó PackageManager).
     - Prueba refutación: rebuild con `compileSdkVersion=34` + `build-tools 34.0.0` (estable) + pinear `@bubblewrap/cli` a una versión estable. Si ese APK instala, H3 confirmada.
  4. 🟩 **H4 — AOSP PackageParser bug with large APK Signing Block v2/v3 padding (5% prob.)**: Algunas versiones rooteadas/custom tienen parches custom que sobre-leen el `APK Signing Block` padding (0x7109871a block id). Si `apksigner` usa un tamaño de padding distinto a lo que el parser espera, produce "Failed to parse base APK". Extremadamente raro pero documentado.
     - Prueba refutación: re-firmar con `apksigner sign --min-sdk-version 24` (fuerza v2+v3 sin padding extras).
- **Mitigaciones PROBADAS pero aún sin éxito reportado por el usuario**:
  - ✅ Wrapper ZIP sin compresión `zip -j -0` del APK para "engañar" a Telegram.
  - ✅ Wrapper ZIP normal `zip -j -9`.
  - ✅ Rename simple a `.zip`.
  - ✅ Bump de versionCode 4→5 para forzar a Android a verlo como actualización estrictamente mayor.
  - ✅ Remoción de Web Share Target intent-filters (guardia M-5).
- **PLAN ESTRUCTURADO DE DIAGNÓSTICO (10 pasos ordenados, NO EJECUTADOS)**:
  - **Paso M-7.1 (Diagnóstico 100% seguro, requiere cable USB)**: Método oro — `adb` para descartar Telegram.
    1. En móvil: Opciones de Desarrollador → Depuración USB → Habilitar.
    2. Conectar cable USB a PC.
    3. En PC: `adb devices` → confirmar `device` autorizado.
    4. Ejecutar **`adb install -r /root/JOB-sda2/CIFRADO-TANGOS/Tango/dist/apk/app-release-signed.apk`** (misma APK que falla por Telegram).
    5. ✅ **Resultado**:
       - Si `Success` → H1 confirmada (Telegram corrompe; APK OK). Fin de la investigación para APK parse-error — usar Python HTTP server o ADB para distribución local.
       - Si `Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]` → H2 confirmada (restos de firma distinta en el teléfono). Pasar a M-7.2.
       - Si `Failure [INSTALL_FAILED_VERSION_DOWNGRADE]` → ya hay una build con versionCode ≥5.
       - Si `Failure [INSTALL_PARSE_FAILED_NO_CERTIFICATES]` o `[INSTALL_PARSE_FAILED_BAD_SIGNATURE]` → firma real corrupta (no pasa en este repo pero revisar).
       - Si `Failure [INSTALL_PARSE_FAILED_MANIFEST_MALFORMED]` → H3/H4 confirmada.
  - **Paso M-7.2 (solo si M-7.1 = UPDATE_INCOMPATIBLE)**: Borrado total a nivel PackageManager.
    1. `adb uninstall com.tangocifrado.app` (borra desde sistema, no solo desde Launcher).
    2. `adb shell cmd package list packages | grep tangocifrado` — debe no devolver nada.
    3. `adb shell pm list packages | grep tango` — idem.
    4. Borrar Chrome App Data desde Settings (TWA associations viven ahí).
    5. Reiniciar teléfono.
    6. Volver a `adb install -r app-release-signed.apk`.
  - **Paso M-7.3 (solo si M-7.1 = MANIFEST_MALFORMED o H3)**: Rebuild con compileSdk=34 estable.
    1. En `tango-cifrado-apk/app/build.gradle` cambiar `compileSdkVersion 36` → `34`.
    2. Opcionalmente pinnear buildToolsVersion a `34.0.0` o `35.0.0` (versiones estables).
    3. Clean build completo (gradlew clean + remove app/build).
    4. Rebuild.
    5. Validar con aapt2 dump badging que `platformBuildVersionCode='34'` y `compileSdkVersion='34'`.
    6. Probar instalación.
  - **Paso M-7.4 (solo si H1 Telegram corruption y ADB no es opción siempre)**: Método Python HTTP server distribution permanente para builds de prueba.
    1. No ejecutar nada sobre APK.
    2. Documentar pasos alternativos al usuario (WIFI local HTTP server, Dropbox, Google Drive) como métodos default de distribución cuando Telegram sigue fallando.
  - **Paso M-7.5 (validar SHA-256 en el móvil)**: Si H1 es la sospechosa, verificar que el APK que llega al móvil tiene el mismo hash.
    1. Subir el APK al móvil sin Telegram (SD card, FTP local, etc.).
    2. Calcular SHA-256 en el móvil (app "Hash Droid" o similar).
    3. Comparar contra `0ad0c9a4d45d5bd95d2da29bd41ac4a468e8c9be31bf925cf5aa2b843c6a80ca`.
    4. Si son distintos → H1 confirmada.
  - **Paso M-7.6 (logcat captura en el dispositivo)**: Solo si todos los anteriores fallan.
    1. `adb logcat -c` (limpiar buffer).
    2. Abrir el APK en el móvil para disparar el error.
    3. Inmediatamente `adb logcat -d | grep -iE "PackageParser|parseBaseApk|parseApkLite|INSTALL_PARSE" > apkparse-error.log`.
    4. El PackageParser de Android reporta el ERROR REAL con línea del manifest o bloque fallido. El error humano "problem parsing" es el generic catch-all; el log tiene la causa real. **Este es el paso que definitivamente acota H3/H4 a un punto concreto del manifest.**
  - **Paso M-7.7 (H4 fix)**: Si logcat dice algo relacionado con "APK Signing Block", "v2 scheme", "failed to read APK Signing Block", re-firmar con build-tools 35.0.0 apksigner con flags estrictos:
    1. `apksigner sign --ks ~/tango-signing/android.keystore --ks-pass pass:$(cat ~/tango-signing/keystore-password.txt) --min-sdk-version 24 --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled false --out app-release-signed-v3off.apk app-release-unsigned-aligned.apk`.
    2. Probar esa variante.
  - **Paso M-7.8 (M-4 / version sync drift check)**: Verificar que `app/build.gradle` no tiene versionCode/versionName que no coincida con `twa-manifest.json`. El drift M-4 puede producir metadata inconsistente en builds limpios.
  - **Paso M-7.9 (applicationId fallback plan)**: Si H2 no se puede limpiar por completo (teléfono con MIUI sin permisos de root para borrar packages.xml), usar un `applicationId` TEMPORAL de prueba para confirmar: cambiar en `app/build.gradle` `applicationId "com.tangocifrado.app"` → `"com.tangocifrado.app.debugtest"`. Recompilar. Si instala, confirma H2 (la asociación de firma residual sobre `com.tangocifrado.app` es la causante). Después revertir a applicationId original — el workaround permanente es M-7.2.
  - **Paso M-7.10 (Wrap-up)**: Concluir y documentar la causa raíz confirmada en el CHANGELOG. Actualizar M-5 si fue H3 (drift compileSdk). Actualizar README sección Distribution si fue H1 (Telegram corrupts APKs).
- **Riesgo de ejecutar este plan**:
  - Bajo. El único cambio "destructivo" es `adb uninstall` en el móvil (Paso M-7.2), que borra datos de Tango Cifrado del dispositivo — pero el usuario ya estaba dispuesto a borrar la app.
  - El cambio de compileSdk (M-7.3) es reversible en una línea.
  - El applicationId debugtest es temporal y NO se publica.
- **Criterio de stop (cuándo parar aunque no todos los pasos se ejecutaron)**:
  - En cuanto M-7.1 (adb) diga `Success` o `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, ya se confirmó una hipótesis y los pasos siguientes son workaround, no investigación.
  - En cuanto M-7.6 (logcat) devuelva una línea con el error real de PackageParser, se cierra investigación.

---

### [ ] M-1: Keystore password reuses a known-compromised value

- **❌ AÚN PENDIENTE.** Riesgo Bajo.
- **File**: `~/tango-signing/keystore-password.txt` (fuera del workspace).
- **Problem**: El password de la keystore limpia (`90:17:F1:AA:...`) sigue siendo `SeVestiraDeFiesta` — el mismo password usado en la keystore comprometida anterior, y listado explícitamente en el array `KNOWN_COMPROMISED_PASSWORDS` de [generate-keystore.sh](file:///root/JOB-sda2/CIFRADO-TANGOS/Tango/scripts/apk/generate-keystore.sh). La **keystore en sí** está limpia (fuera del workspace, nunca se exportó), pero la defensa en profundidad pide una contraseña nunca usada.
- **Fix documentado en PASOS_APK.md**: requiere regenerar keystore → nuevo fingerprint → nuevo `assetlinks.json` en **ambos** repos → **reinstalacción total del APK** en todos los dispositivos (Android rechaza actualizaciones con firma distinta). **No urgente**; solo ejecutar en un momento conveniente para redistribuir.
- **Estado**: no hay riesgo inmediato (la keystore nunca se filtró). Se queda pendiente hasta la próxima regeneración de APK.

### [x] M-2: strings.xml and colors.xml committed as stubs — CI must not rely on them

- **✅ RESUELTO (doble guardia). Auditado 2026-08-13.**
- **Guardia 1 (prevención)**: `strings.xml` + `colors.xml` agregados a [tango-cifrado-apk/.gitignore](file:///root/JOB-sda2/CIFRADO-TANGOS/Tango/tango-cifrado-apk/.gitignore#L64-L65) con comentario explicativo. Los stubs **no pueden commitearse por accidente** nunca más.
- **Guardia 2 (detección post-build)**: Smoke-test **M-2 guard** STEP completo en [build-twa-apk.yml:303-363](file:///root/JOB-sda2/CIFRADO-TANGOS/Tango/.github/workflows/build-twa-apk.yml#L303-L363). Usa `aapt2 dump xmltree` + `aapt2 dump resources` sobre CADA APK compilado y valida:
  - `string/hostName` existe + NO vacío + NO es stub `TODO`/`example.com`
  - `string/launchUrl` ídem
  - `string/colorPrimary` ídem
  - Si CUALQUIER APK falla → `exit 1` → workflow falla → **no publica Release**.
- **Estado**: las dos capas cubren el riesgo de CI. Puedes marcarlo como done.

---

## 🔧 Chunking edge cases (Fase 10.1)

### [x] C-1: Single token longer than chunk budget is not guarded

- **✅ RESUELTO. Auditado 2026-08-13 en [chunked-text.js:41-143](file:///root/JOB-sda2/CIFRADO-TANGOS/Tango/pwa/core/transport/chunked-text.js#L41-L143).**
- **Detalles del fix (docstring + código real)**:
  - Branch explícito `if (alone && token.length > effectiveMax)` al principio del loop (línea 101): maneja el caso de UN SOLO token oversized (el bug reportado).
  - 3 vías:
    1. Token entra en el budget después de proyectar el prefix → emite chunk.
    2. `fit < 16` (budget marginal): **throw `TokenOverflowError` descriptivo** con props `tokenLength`, `maxLen`, `budget`, `chunkIndex` y texto de error en español explicando que la tira de dígitos sin separadores produce un fallback XOR único demasiado largo.
    3. Si no: **byte-split** `token.slice(0, fit)` + `tokens.splice(t+1, 0, slice2)` — el resto se reprocesa en la próxima iteración (loop es seguro, se vuelve a entrar en este branch si `slice2` sigue siendo oversized).
- **Tests verificados**: `tests/js/transport.test.mjs` → 3 nuevos tests cubren: single oversized token byte-split, TokenOverflowError con props verificadas, multi-stage splitting. Todos los caminos del branch C-1 están cubiertos. ✅

### [x] C-2: No partial-send recovery on mid-send network failure

- **✅ RESUELTO. Auditado 2026-08-13 en [chunked-text.js:220-265](file:///root/JOB-sda2/CIFRADO-TANGOS/Tango/pwa/core/transport/chunked-text.js#L220-L265) + [document.js](file:///root/JOB-sda2/CIFRADO-TANGOS/Tango/pwa/core/transport/document.js).**
- **Fix**: Ambos transports levantan errores con **metadatos estructurados de recuperación parcial**:
  - Propiedades presentes en TODO error de red y error HTTP:
    - `.chunksSentBeforeFail = i` (0-indexed: número de chunks enviados EXITOSAMENTE antes de fallar)
    - `.chunksTotal = chunks.length`
    - `.partIndex = i + 1` (1-indexed para copy en el UI humano)
    - `.isPartialSend = i > 0` → `true` si ya se habrían filtrado fragments por Telegram.
  - En `chunked-text.js`: errores de red son `TelegramNetworkError`, errores de HTTP son `TelegramApiError` con `httpStatus` + `detalle` de `data.description`. El mensaje humano incluye: *"Error de red al enviar a Telegram en parte i/N (partes 1 a i-1 ya fueron enviados)."*
  - En `document.js`: mismos campos por simetría (mono-request → `chunksSentBeforeFail=0`, `isPartialSend=false` siempre).
- **Estado**: El UI handler de errores en `app.js` puede chequear `err.isPartialSend` y mostrar un toast/warning cuando fragments ya llegaron al receiver → **el usuario sabe qué chunks van y cuáles no**. El caso "no hay información" ya no existe. OK.

