#!/usr/bin/env bash
# ============================================================
# Script consolidado TODO-EN-UNO para correr en el sandbox.
# Escribe TODO a logs/ para evitar que el wrapper corte output.
# ============================================================
set -u  # no -e, queremos seguir aunque un paso falle

REPO_ROOT="$(cd "$(dirname "$BASH_SOURCE")/../.." && pwd)"
LOG_DIR="$REPO_ROOT/_build_apk_logs"
mkdir -p "$LOG_DIR"

export PATH="/root/.local/share/node20/bin:$PATH"
export JAVA_HOME="$(dirname $(dirname $(readlink -f $(which java))))" 2>/dev/null || true
export KEYSTORE_PASS="TangoCifrado-Sandbox-2026!"
export KEYSTORE_ALIAS="android"
export PACKAGE_NAME="com.tangocifrado.app"

echo "============================================================"
echo "⚠️  ESTE SCRIPT GENERA UNA KEYSTORE DE PRUEBA, NO DE PRODUCCIÓN."
echo "   La contraseña está hardcodeada arriba y es pública en el repo."
echo "   NUNCA firmes un APK real distribuido con esta keystore."
echo "   Después de correr esto, ejecutá:"
echo "     scripts/apk/purge-sandbox-keystore.sh"
echo "   y regenerá una keystore real en tu máquina."
echo "============================================================"
cd "$REPO_ROOT"
touch "$REPO_ROOT/tango-cifrado-apk/SANDBOX_KEYSTORE_DO_NOT_SHIP.txt"

cd "$REPO_ROOT"

log()  { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_DIR/00_summary.log"; }
step() { log "===== $* ====="; }

# ===== 1. Verify deps =====
step "1. Verify / install deps"
{
  echo "--- which ---"
  for b in java keytool javac node npm bubblewrap; do
    printf '%-12s -> ' "$b"
    command -v "$b" 2>/dev/null || echo "(missing)"
  done
  echo "--- versions ---"
  java -version 2>&1 ; node -v 2>&1 ; npm -v 2>&1
} > "$LOG_DIR/01_deps.log" 2>&1

# ===== 2. Install Bubblewrap if missing =====
if ! command -v bubblewrap >/dev/null 2>&1; then
  step "2. Install @bubblewrap/cli"
  npm install -g @bubblewrap/cli --no-audit --no-fund >"$LOG_DIR/02_bubblewrap_install.log" 2>&1
  BWRC=$?
  echo "bubblewrap install exit: $BWRC" >> "$LOG_DIR/00_summary.log"
  hash -r
else
  step "2. Bubblewrap already installed, skipping install"
  echo "bubblewrap already installed, skip" >> "$LOG_DIR/00_summary.log"
fi
echo "bubblewrap location after: $(command -v bubblewrap 2>/dev/null || echo MISSING)" >> "$LOG_DIR/01_deps.log"
command -v bubblewrap >/dev/null 2>&1 && bubblewrap --version 2>&1 >> "$LOG_DIR/01_deps.log"

# ===== 3. Generate keystore =====
step "3. Generate android.keystore (if not exists)"
if [ -f "$REPO_ROOT/tango-cifrado-apk/android.keystore" ]; then
  echo "keystore exists, skip generation" >> "$LOG_DIR/03_keystore.log"
else
  bash "$REPO_ROOT/scripts/apk/generate-keystore.sh" >"$LOG_DIR/03_keystore.log" 2>&1
  echo "generate-keystore exit: $?" >> "$LOG_DIR/00_summary.log"
fi
ls -la "$REPO_ROOT/tango-cifrado-apk/" >> "$LOG_DIR/03_keystore.log" 2>/dev/null || true

# ===== 4. Generate assetlinks =====
step "4. Generate assetlinks.json (both .well-known dirs)"
bash "$REPO_ROOT/scripts/apk/generate-assetlinks.sh" >"$LOG_DIR/04_assetlinks.log" 2>&1
echo "generate-assetlinks exit: $?" >> "$LOG_DIR/00_summary.log"
{
  echo "--- root .well-known/assetlinks.json ---"
  cat "$REPO_ROOT/.well-known/assetlinks.json" 2>/dev/null || echo "(MISSING)"
  echo "--- pwa/.well-known/assetlinks.json ---"
  cat "$REPO_ROOT/pwa/.well-known/assetlinks.json" 2>/dev/null || echo "(MISSING)"
} >> "$LOG_DIR/04_assetlinks.log"

# ===== 5. Generate twa-manifest.json manually =====
step "5. Write twa-manifest.json in tango-cifrado-apk/"
{
  TWA="$REPO_ROOT/tango-cifrado-apk/twa-manifest.json"
  if [ -f "$TWA" ]; then
    echo "twa-manifest.json exists, skip"
  else
    cat > "$TWA" <<'JSONEOF'
{
  "packageId": "__PACKAGE_ID__",
  "host": "misbusquedaspersonales-cyber.github.io",
  "name": "Tango Cifrado",
  "launcherName": "Tango Cifrado",
  "themeColor": "#1a110f",
  "backgroundColor": "#1a110f",
  "navigationColor": "#1a110f",
  "navigationColorDark": "#0a0605",
  "navigationDividerColor": "#2a1a15",
  "startUrl": "/tango_cipher_bot_public/pwa/index.html?src=twa-apk",
  "iconUrl": "https://misbusquedaspersonales-cyber.github.io/tango_cipher_bot_public/pwa/icons/icon-512.png",
  "maskableIconUrl": "https://misbusquedaspersonales-cyber.github.io/tango_cipher_bot_public/pwa/icons/icon-maskable-512.png",
  "display": "standalone",
  "orientation": "portrait",
  "minSdkVersion": 21,
  "targetSdkVersion": 34,
  "serviceAccountJsonFile": "",
  "fingerprints": [],
  "enableNotifications": false,
  "enableGeolocation": false,
  "enableSiteSettingsShortcut": true,
  "isChromeOSOnly": false,
  "isMetaQuery": false,
  "retainedBundles": [],
  "versionCode": 1,
  "versionName": "1.0.0",
  "signingKey": {
    "path": "./android.keystore",
    "alias": "__ALIAS__"
  },
  "splashScreenFadeOutDuration": 300
}
JSONEOF
    sed -i "s/__PACKAGE_ID__/$PACKAGE_NAME/" "$TWA"
    sed -i "s/__ALIAS__/$KEYSTORE_ALIAS/"         "$TWA"
    echo "CREATED twa-manifest.json"
  fi
  echo "--- twa-manifest.json (first 25 lines) ---"
  head -n 25 "$TWA"
} > "$LOG_DIR/05_twamanifest.log" 2>&1

# ===== 6. Android SDK — attempt autoinstall if sdkmanager missing =====
step "6. Prepare Android SDK (cmdline-tools + accept licenses)"
{
  # Set up ANDROID_HOME to a path inside /root (allowed writable)
  export ANDROID_HOME="/root/.local/share/android-sdk"
  export ANDROID_SDK_ROOT="$ANDROID_HOME"
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  echo "ANDROID_HOME=$ANDROID_HOME"

  if [ ! -d "$ANDROID_HOME/cmdline-tools/latest" ] && [ ! -d "$ANDROID_HOME/cmdline-tools/tools" ]; then
    CT_URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
    CT_ZIP="/tmp/android-cmdline-tools.zip"
    if [ ! -f "$CT_ZIP" ]; then
      echo "Downloading cmdline-tools..."
      curl -fsSL -o "$CT_ZIP" "$CT_URL" || { echo "CURL FAILED $?"; exit 1; }
    else
      echo "cmdline-tools zip already cached, skipping download"
    fi
    echo "Unzipping cmdline-tools..."
    unzip -q -o "$CT_ZIP" -d "$ANDROID_HOME/cmdline-tools"
    # cmdline tools zips extract as /cmdline-tools/cmdline-tools/* — move to /latest/
    if [ -d "$ANDROID_HOME/cmdline-tools/cmdline-tools" ]; then
      mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
    fi
  fi

  export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
  echo "PATH now: $PATH"
  echo "sdkmanager location: $(command -v sdkmanager || echo MISSING)"

  if command -v sdkmanager >/dev/null 2>&1; then
    echo "--- sdkmanager version ---"
    sdkmanager --version 2>&1 | head -n 3
    echo "--- accepting licenses ---"
    yes | sdkmanager --sdk_root="$ANDROID_HOME" --licenses >/dev/null 2>&1 || true
    echo "--- installing required packages ---"
    sdkmanager --sdk_root="$ANDROID_HOME" \
      "platform-tools" \
      "platforms;android-34" \
      "build-tools;34.0.0" \
      >"$LOG_DIR/06_android_sdk_install.log" 2>&1
    SDK_INSTALL_RC=$?
    echo "sdkmanager packages install exit: $SDK_INSTALL_RC"
    tail -n 5 "$LOG_DIR/06_android_sdk_install.log"
  else
    echo "sdkmanager NOT AVAILABLE — bubblewrap build will likely try to auto-download SDK"
  fi
} > "$LOG_DIR/06_sdk.log" 2>&1
SDK_RC=$?
echo "SDK prep exit: $SDK_RC" >> "$LOG_DIR/00_summary.log"

# ===== 7. Run bubblewrap build =====
step "7. bubblewrap build (timeout 40min, will be slow — downloads Gradle + deps)"
export ANDROID_HOME="${ANDROID_HOME:-/root/.local/share/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
cd "$REPO_ROOT/tango-cifrado-apk"
echo "  cwd: $(pwd)" >> "$LOG_DIR/00_summary.log"
echo "  ANDROID_HOME=$ANDROID_HOME" >> "$LOG_DIR/00_summary.log"

# Bubblewrap build is slow — run without -timeout bash builtin because downloads
# can take 10-30 min. We run in background with PID, wait with timeout.
BUILDLOG="$LOG_DIR/07_build.log"
bash "$REPO_ROOT/scripts/apk/build-apk.sh" >"$BUILDLOG" 2>&1 &
BUILD_PID=$!
# Wait max 35 minutes (2100s)
SECONDS_LEFT=2100
while kill -0 $BUILD_PID 2>/dev/null && [ $SECONDS_LEFT -gt 0 ]; do
  sleep 30
  SECONDS_LEFT=$((SECONDS_LEFT - 30))
  echo "  ... still building ($SECONDS_LEFT s left), last 3 lines of log:" >> "$LOG_DIR/00_summary.log"
  tail -n 3 "$BUILDLOG" 2>/dev/null >> "$LOG_DIR/00_summary.log" || true
done
if kill -0 $BUILD_PID 2>/dev/null; then
  echo "  ⏱️  BUILD TIMED OUT after ~35min; killing build pid $BUILD_PID" >> "$LOG_DIR/00_summary.log"
  kill -9 $BUILD_PID 2>/dev/null || true
  sleep 5
fi
wait $BUILD_PID 2>/dev/null
BUILD_RC=$?
echo "bubblewrap build exit: $BUILD_RC" >> "$LOG_DIR/00_summary.log"

# ===== 8. Final report =====
step "8. Final inventory"
{
  echo
  echo "============ FINAL INVENTORY ============"
  echo
  echo "--- Keystore ---"
  ls -la "$REPO_ROOT/tango-cifrado-apk/android.keystore" 2>/dev/null || echo "(missing)"
  if [ -f "$REPO_ROOT/tango-cifrado-apk/android.keystore" ]; then
    echo "Fingerprint SHA256:"
    keytool -list -v -keystore "$REPO_ROOT/tango-cifrado-apk/android.keystore" \
      -alias "$KEYSTORE_ALIAS" -storepass "$KEYSTORE_PASS" 2>/dev/null \
      | grep -E "^\s*SHA256:" || echo "(fingerprint read failed)"
  fi
  echo
  echo "--- assetlinks.json (root) ---"
  test -f "$REPO_ROOT/.well-known/assetlinks.json" && cat "$REPO_ROOT/.well-known/assetlinks.json" || echo "(missing)"
  echo
  echo "--- twa-manifest.json ---"
  test -f "$REPO_ROOT/tango-cifrado-apk/twa-manifest.json" && head -n 10 "$REPO_ROOT/tango-cifrado-apk/twa-manifest.json" || echo "(missing)"
  echo
  echo "--- Build outputs: dist/apk/ ---"
  if [ -d "$REPO_ROOT/dist/apk" ]; then
    find "$REPO_ROOT/dist/apk" -maxdepth 2 -type f \( -name "*.apk" -o -name "*.aab" \) -printf "  %p  %s bytes\n" || echo "(none found)"
  else
    echo "(no dist/apk dir — build not run or failed)"
  fi
  echo
  echo "--- Build outputs: inside tango-cifrado-apk/ ---"
  find "$REPO_ROOT/tango-cifrado-apk" -maxdepth 6 -type f \( -name "*.apk" -o -name "*.aab" \) -not -path "*/build/*" -printf "  %p  %s bytes\n" 2>/dev/null || true
  echo
  echo "===== LOGS (in _build_apk_logs/): ====="
  ls -la "$LOG_DIR/"
} | tee -a "$LOG_DIR/08_inventory.log" "$LOG_DIR/00_summary.log"

echo
echo "========== DONE. Ver _build_apk_logs/00_summary.log para el resumen. =========="

