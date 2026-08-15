#!/usr/bin/env bash
# scripts/apk/purge-sandbox-keystore.sh
#
# Borra cualquier keystore/assetlinks generados en un sandbox de testing.
# Correlo ANTES de generar la keystore real de producción si alguna vez
# corriste _runall_sandbox.sh o cualquier script con KEYSTORE_PASS seteada
# a un valor de prueba.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
APK_DIR="$REPO_ROOT/tango-cifrado-apk"

echo "Borrando material de firma de sandbox (si existe)..."
rm -fv \
  "$APK_DIR/android.keystore" \
  "$APK_DIR/keystore-password.txt" \
  "$APK_DIR/twa-manifest.json" \
  "$APK_DIR/assetlinks.generated.json" \
  "$APK_DIR/SANDBOX_KEYSTORE_DO_NOT_SHIP.txt" \
  "$REPO_ROOT/.well-known/assetlinks.json" \
  "$REPO_ROOT/pwa/.well-known/assetlinks.json"

rm -rf "$REPO_ROOT/_build_apk_logs"

echo
echo "✅ Listo. Corré ahora, desde tu máquina (NO desde un sandbox que se exporte):"
echo "   cd tango-cifrado-apk"
echo "   ../scripts/apk/generate-keystore.sh"
echo "   ../scripts/apk/generate-assetlinks.sh"
echo "   git add .well-known/assetlinks.json pwa/.well-known/assetlinks.json"
echo "   git commit -m 'deploy(assetlinks): real keystore fingerprint'"
echo "   git push"

