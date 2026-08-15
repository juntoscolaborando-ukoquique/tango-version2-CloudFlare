#!/usr/bin/env bash
# scripts/apk/generate-assetlinks.sh
#
# Lee la keystore (generada por generate-keystore.sh), extrae el SHA-256 y
# produce el assetlinks.json listo para copiar a .well-known/ (tanto en el
# root del Pages como en pwa/.well-known/, las dos rutas habituales).
#
# Uso:
#   cd tango-cifrado-apk && ../scripts/apk/generate-assetlinks.sh
#
# También se puede correr desde la raíz:
#   ./scripts/apk/generate-assetlinks.sh
#
# Variables de entorno opcionales:
#   PACKAGE_NAME   default: com.tangocifrado.app (debe coincidir con bubblewrap init)
#   KEYSTORE_PASS  si no está, lee de tango-cifrado-apk/keystore-password.txt o pregunta

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [ -f "$PWD/twa-config.json" ] && [ "$(basename "$PWD")" = "tango-cifrado-apk" ]; then
  APK_DIR="$PWD"
else
  APK_DIR="$REPO_ROOT/tango-cifrado-apk"
fi

ROOT_WELLKNOWN="$REPO_ROOT/.well-known/assetlinks.json"
PACKAGE_NAME="${PACKAGE_NAME:-com.tangocifrado.app}"
ALIAS="${KEYSTORE_ALIAS:-android}"
PASS_FILE="$APK_DIR/keystore-password.txt"

# ── Keystore resolution — same priority as build-apk.sh ─────────────────────
# 1. KEYSTORE_FILE env var (explicit override)
# 2. ~/tango-signing/android.keystore (recommended out-of-repo location)
# 3. $APK_DIR/android.keystore (legacy in-workspace path)
if [ -z "${KEYSTORE_FILE:-}" ]; then
  if [ -f "$HOME/tango-signing/android.keystore" ]; then
    KEYSTORE_FILE="$HOME/tango-signing/android.keystore"
  else
    KEYSTORE_FILE="$APK_DIR/android.keystore"
  fi
fi

# Prefer ~/tango-signing/keystore-password.txt for password fallback
if [ -f "$HOME/tango-signing/keystore-password.txt" ]; then
  PASS_FILE="$HOME/tango-signing/keystore-password.txt"
fi

ROOT_WELLKNOWN="$REPO_ROOT/.well-known/assetlinks.json"
PWA_WELLKNOWN="$REPO_ROOT/pwa/.well-known/assetlinks.json"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ ! -f "$KEYSTORE_FILE" ]; then
  echo -e "${RED}❌ No se encontró $KEYSTORE_FILE.${NC}"
  echo "   Corré primero: ../scripts/apk/generate-keystore.sh"
  exit 1
fi

if [ -n "${KEYSTORE_PASS:-}" ]; then
  KS_PASS="$KEYSTORE_PASS"
elif [ -f "$PASS_FILE" ]; then
  KS_PASS="$(cat "$PASS_FILE")"
else
  read -r -s -p "Contraseña de la keystore: " KS_PASS
  echo
fi

SHA_LINE=$(keytool -list -v -keystore "$KEYSTORE_FILE" -alias "$ALIAS" -storepass "$KS_PASS" 2>/dev/null \
  | grep -E "^\s*SHA256:" | head -n1 | sed 's/.*SHA256:\s*//' || true)

if [ -z "$SHA_LINE" ]; then
  echo -e "${RED}❌ No pude extraer el SHA-256. ¿Contraseña correcta? ¿Alias '$ALIAS' existe?${NC}"
  echo "   Verificá alias disponibles:"
  echo "   keytool -list -v -keystore $KEYSTORE_FILE"
  exit 1
fi

# Asegurar formato XX:YY:ZZ (uppercase hex con dos puntos cada 2 chars).
# keytool normalmente ya lo entrega así, pero por si acaso.
SHA256=$(echo "$SHA_LINE" | tr -d '[:space:]' | tr 'a-f' 'A-F')

echo
echo "============================================================"
echo -e "  ${GREEN}SHA-256 del certificado de firma:${NC}"
echo "============================================================"
echo "   $SHA256"
echo

ASSETLINKS=$(cat <<EOF
[
  {
    "relation": [
      "delegate_permission/common.handle_all_urls"
    ],
    "target": {
      "namespace": "android_app",
      "package_name": "$PACKAGE_NAME",
      "sha256_cert_fingerprints": [
        "$SHA256"
      ]
    }
  }
]
EOF
)

echo "============================================================"
echo -e "  ${GREEN}assetlinks.json generado:${NC}"
echo "============================================================"
echo "$ASSETLINKS"
echo

OUT_TMP="$APK_DIR/assetlinks.generated.json"
echo "$ASSETLINKS" > "$OUT_TMP"
log_ok_line() {
  echo -e "${GREEN}✅ Escrito:${NC} $1"
}
echo "$ASSETLINKS" > "$ROOT_WELLKNOWN"
log_ok_line "$ROOT_WELLKNOWN"
echo "$ASSETLINKS" > "$PWA_WELLKNOWN"
log_ok_line "$PWA_WELLKNOWN"
log_ok_line "(duplicado) $OUT_TMP"

echo
echo "============================================================"
echo -e "  ${YELLOW}⚠️  PASOS QUE FALTAN:${NC}"
echo "============================================================"
echo " 1. Confirmá EN QUÉ RUTA sirve tu GitHub Pages:"
echo "      • Root del repo → ${YELLOW}sirve $ROOT_WELLKNOWN${NC} ✔️  ya escrito"
echo "      • /pwa/ subdir    → ${YELLOW}sirve $PWA_WELLKNOWN${NC} ✔️  ya escrito"
echo "    Ambos archivos tienen el mismo contenido para cubrir los dos casos."
echo
echo " 2. Pushealo al repo público:"
echo "      git add .well-known/assetlinks.json pwa/.well-known/assetlinks.json"
echo "      git commit -m \"deploy(assetlinks): $PACKAGE_NAME SHA256 fingerprint\""
echo "      git push origin main"
echo
echo " 3. Esperá ~1min y validá con curl que sea accesible PÚBLICAMENTE (Content-Type: application/json):"
echo "      curl -sI \"https://misbusquedaspersonales-cyber.github.io/tango_cipher_bot_public/.well-known/assetlinks.json\""
echo "      curl -s \"https://misbusquedaspersonales-cyber.github.io/tango_cipher_bot_public/.well-known/assetlinks.json\""
echo
echo " 4. Verificación oficial de Google (OBLIGATORIO antes de compilar el APK):"
echo "      ${YELLOW}https://developers.google.com/digital-asset-links/tools/generator${NC}"
echo "      Domain         : misbusquedaspersonales-cyber.github.io"
echo "      App package    : $PACKAGE_NAME"
echo "      SHA256 fingerprint: $SHA256"
echo
echo " 5. Si la validación falla:"
echo "      • Revisá que el assetlinks.json no tenga BOM ni trailing chars raros."
echo "      • Revisá que Content-Type sea application/json (GitHub Pages lo hace"
echo "        automágicamente para archivos .json — si usás redirects raros, chequear."
echo "      • Revisá que el package_name y el SHA256 coincidan EXACTAMENTE con los"
echo "        que Bubblewrap usó en el init."

