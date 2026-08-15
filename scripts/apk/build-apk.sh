#!/usr/bin/env bash
# scripts/apk/build-apk.sh
#
# Wrapper idempotente sobre bubblewrap build. Se asegura de:
#   • Estar en el directorio correcto (tango-cifrado-apk/)
#   • Tener bubblewrap + jdk disponibles
#   • Leer la pass de keystore-password.txt (si existe) sin re-preguntar
#   • Copiar los artefactos a dist/apk/ para que sea fácil encontrarlos
#
# Uso:
#   cd tango-cifrado-apk && ../scripts/apk/build-apk.sh
#   ./scripts/apk/build-apk.sh      (desde la raíz)
#
# Variables de entorno opcionales:
#   KEYSTORE_FILE    ruta absoluta a android.keystore (override; ver resolución abajo)
#   KEYSTORE_PASS    contraseña de la keystore (override; ver resolución abajo)
#   BUILD_OUTPUT_DIR donde copiar .apk + .aab (default: dist/apk/ en el repo)
#   SKIP_BUBBLEWRAP_CHECK=1  salta la validación de que twa-manifest.json exista

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [ -f "$PWD/twa-manifest.json" ] && [ -d "$PWD/app" -o -f "$PWD/twa-config.json" ]; then
  APK_DIR="$PWD"
else
  APK_DIR="$REPO_ROOT/tango-cifrado-apk"
fi

PASS_FILE="$APK_DIR/keystore-password.txt"
OUT_DIR="${BUILD_OUTPUT_DIR:-$REPO_ROOT/dist/apk}"

# ── Keystore resolution (never stored in the repo) ──────────────────────────
# Priority:
#   1. KEYSTORE_FILE env var (explicit override)
#   2. ~/tango-signing/android.keystore  (recommended out-of-repo location)
#   3. $APK_DIR/android.keystore         (legacy in-workspace path, discouraged)
# Password resolution:
#   1. KEYSTORE_PASS env var
#   2. ~/tango-signing/keystore-password.txt
#   3. $APK_DIR/keystore-password.txt    (legacy)
#   4. Interactive prompt
if [ -n "${KEYSTORE_FILE:-}" ]; then
  RESOLVED_KEYSTORE="$KEYSTORE_FILE"
elif [ -f "$HOME/tango-signing/android.keystore" ]; then
  RESOLVED_KEYSTORE="$HOME/tango-signing/android.keystore"
elif [ -f "$APK_DIR/android.keystore" ]; then
  RESOLVED_KEYSTORE="$APK_DIR/android.keystore"
else
  RESOLVED_KEYSTORE=""
fi

if [ -z "${KEYSTORE_PASS:-}" ]; then
  if [ -f "$HOME/tango-signing/keystore-password.txt" ]; then
    export KEYSTORE_PASS="$(cat "$HOME/tango-signing/keystore-password.txt")"
  elif [ -f "$APK_DIR/keystore-password.txt" ]; then
    export KEYSTORE_PASS="$(cat "$APK_DIR/keystore-password.txt")"
  fi
fi

# bubblewrap NO lee KEYSTORE_PASS (nombre inventado por este script) -- solo
# reconoce BUBBLEWRAP_KEYSTORE_PASSWORD y BUBBLEWRAP_KEY_PASSWORD para saltear
# el prompt interactivo de "Password for the Key Store" / "Password for the
# Key". Sin esto, `bubblewrap build` pregunta a mano SIEMPRE, sin importar
# que KEYSTORE_PASS ya esté resuelto acá arriba. KEYSTORE_KEY_PASS es
# opcional -- si no se seteó, usamos el mismo valor que la keystore
# (comportamiento por defecto de generate-keystore.sh: key password = store
# password salvo que se haya generado distinto a propósito).
export BUBBLEWRAP_KEYSTORE_PASSWORD="$KEYSTORE_PASS"
export BUBBLEWRAP_KEY_PASSWORD="${KEYSTORE_KEY_PASS:-$KEYSTORE_PASS}"

# Prefer ~/tango-signing/keystore-password.txt for PASS_FILE interactive fallback
if [ -f "$HOME/tango-signing/keystore-password.txt" ]; then
  PASS_FILE="$HOME/tango-signing/keystore-password.txt"
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo -e "${RED}❌ '$1' no está en \$PATH.${NC} Corré: ${YELLOW}../scripts/apk/install-deps.sh${NC}"
    exit 1
  fi
}
need keytool
need bubblewrap
need java

cd "$APK_DIR"

if [ "${SKIP_BUBBLEWRAP_CHECK:-0}" != "1" ] && [ ! -f "$APK_DIR/twa-manifest.json" ]; then
  echo -e "${YELLOW}⚠️  No existe twa-manifest.json en $APK_DIR.${NC}"
  echo "   Esto significa que nunca corriste bubblewrap init. Intentando correrlo..."
  echo "   Si el wizard falla, corré a mano:"
  echo "     bubblewrap init --manifest=https://misbusquedaspersonales-cyber.github.io/tango_cipher_bot_public/pwa/manifest.json"
  echo
  bubblewrap init --manifest="https://misbusquedaspersonales-cyber.github.io/tango_cipher_bot_public/pwa/manifest.json"
fi

# ── Sincronizar share_target (Web Share Target) hacia twa-manifest.json ─────
# `bubblewrap init` (arriba) solo lee share_target de pwa/manifest.json la
# PRIMERA VEZ que se genera twa-manifest.json. Si twa-manifest.json ya
# existía de antes (como en este repo, donde se generó antes de que Fase
# 10.1.1 agregara share_target), bubblewrap build nunca se entera del
# cambio y compila un APK sin el intent-filter de "Compartir con esta
# app". sync-share-target.sh corrige esto en cada build: no hace nada si
# ya está sincronizado, y si no, actualiza twa-manifest.json y corre
# `bubblewrap update` para regenerar el proyecto Android antes de compilar.
if [ "${SKIP_BUBBLEWRAP_CHECK:-0}" != "1" ]; then
  "$SCRIPT_DIR/sync-share-target.sh" "$APK_DIR"
fi

if [ -z "$RESOLVED_KEYSTORE" ]; then
  echo -e "${RED}❌ No se encontró android.keystore.${NC}"
  echo
  echo "   Opciones:"
  echo "   1. Copiá la keystore al directorio recomendado (fuera del repo):"
  echo "        mkdir -p ~/tango-signing"
  echo "        cp /ruta/a/android.keystore ~/tango-signing/"
  echo "   2. Pasá la ruta explícita como variable de entorno:"
  echo "        KEYSTORE_FILE=/ruta/a/android.keystore ../scripts/apk/build-apk.sh"
  echo "   3. Generá una nueva keystore (solo si no tenés la original):"
  echo "        ../scripts/apk/generate-keystore.sh"
  exit 1
fi

if [ -z "${KEYSTORE_PASS:-}" ]; then
  if [ -f "$PASS_FILE" ]; then
    export KEYSTORE_PASS="$(cat "$PASS_FILE")"
  else
    read -r -s -p "Contraseña de la keystore: " KEYSTORE_PASS
    export KEYSTORE_PASS
    echo
  fi
fi

echo "============================================================"
echo -e "  ${GREEN}Compilando APK (bubblewrap build)${NC}"
echo "============================================================"
echo "  Directorio : $APK_DIR"
echo "  Keystore   : $RESOLVED_KEYSTORE"
echo

# ── Patch twa-manifest.json with the resolved keystore path ─────────────────
# bubblewrap reads signingKey.path from twa-manifest.json. If the keystore
# lives outside the workspace (recommended), we patch it to the absolute path
# before building, then restore the original on exit.
MANIFEST="$APK_DIR/twa-manifest.json"
MANIFEST_BAK="$APK_DIR/twa-manifest.json.bak"
cp "$MANIFEST" "$MANIFEST_BAK"
cleanup_manifest() {
  mv "$MANIFEST_BAK" "$MANIFEST" 2>/dev/null || true
}
trap cleanup_manifest EXIT INT TERM

python3 - "$MANIFEST" "$RESOLVED_KEYSTORE" <<'PYEOF'
import sys, json
path, ks = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)
data["signingKey"]["path"] = ks
with open(path, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PYEOF

# ── Ensure ~/.bubblewrap/config.json has the JDK path pre-filled ─────────────
# bubblewrap opens /dev/tty directly for its JDK prompt, so stdin pipes don't
# work. The only reliable fix is to pre-populate its config file.
BWRAP_CONFIG="$HOME/.bubblewrap/config.json"
if [ -f "$BWRAP_CONFIG" ]; then
  current_jdk="$(python3 -c "import json; d=json.load(open('$BWRAP_CONFIG')); print(d.get('jdkPath',''))")"
  if [ -z "$current_jdk" ]; then
    if [ -n "${JAVA_HOME:-}" ] && [ -d "$JAVA_HOME" ]; then
      JDK_PATH="$JAVA_HOME"
    else
      JAVA_BIN="$(readlink -f "$(which java)")"
      JDK_PATH="$(dirname "$(dirname "$JAVA_BIN")")"
    fi
    python3 - "$BWRAP_CONFIG" "$JDK_PATH" <<'PYEOF'
import sys, json
cfg, jdk = sys.argv[1], sys.argv[2]
with open(cfg) as f:
    data = json.load(f)
data["jdkPath"] = jdk
with open(cfg, "w") as f:
    json.dump(data, f)
    f.write("\n")
PYEOF
    echo "  ℹ️  ~/.bubblewrap/config.json actualizado con JDK: $JDK_PATH"
    echo
  fi
fi

export CI="${CI:-true}"
bubblewrap build

echo
echo -e "${GREEN}✅ bubblewrap build finalizado.${NC}"

mkdir -p "$OUT_DIR"
copiado=0
for f in "$APK_DIR"/*release*signed.apk "$APK_DIR"/*release*.aab "$APK_DIR"/app/release/*.apk "$APK_DIR"/app/release/*.aab; do
  if [ -f "$f" ]; then
    cp -v "$f" "$OUT_DIR/"
    copiado=1
  fi
done

if [ "$copiado" = "0" ]; then
  echo -e "${YELLOW}⚠️  No se encontraron archivos .apk/.aab en $APK_DIR.${NC}"
  echo "   Buscando artefactos..."
  find "$APK_DIR" -maxdepth 5 \( -name "*.apk" -o -name "*.aab" \) -not -path "*/build/*" | head -n 20 || true
fi

echo
echo "============================================================"
echo -e "  ${GREEN}Listo. Siguientes pasos:${NC}"
echo "============================================================"
if [ "$copiado" = "1" ]; then
  echo "   • Artefactos copiados a: $OUT_DIR"
  ls -lah "$OUT_DIR" | tail -n +2
fi
echo
echo "   • Sideload: pasá $OUT_DIR/app-release-signed.apk a tu Android (Telegram, USB, etc.),"
echo "     habilitá 'Fuentes desconocidas' e instalalo."
echo "   • ✅ CHEQUEO CLAVE: abrí la app — NO debe verse la barra de URL de Chrome."
echo "     Si se ve, el assetlinks.json no validó → revisá generate-assetlinks.sh."
echo "   • Updates de la PWA (app.js, etc.) se reciben automáticamente — NO requieren nuevo APK."
echo "     Solo re-corré build-apk.sh si cambia el wrapper (ícono, nombre, versión, permisos)."

