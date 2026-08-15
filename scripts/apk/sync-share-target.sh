#!/usr/bin/env bash
#
# scripts/apk/sync-share-target.sh
#
# PROBLEMA QUE RESUELVE:
# `bubblewrap init` solo lee `share_target` de pwa/manifest.json la
# PRIMERA VEZ que genera tango-cifrado-apk/twa-manifest.json. Todo build
# posterior corre `bubblewrap build`, que compila el proyecto Android ya
# generado -- nunca vuelve a leer el manifest.json de la PWA.
#
# En este repo, twa-manifest.json ya existía (versionCode 3) desde ANTES
# de que Fase 10.1.1 agregara `share_target` a pwa/manifest.json. Resultado:
# el Service Worker y el manifest web soportan Web Share Target
# perfectamente, pero el .apk firmado que se compila y se sideloadea NUNCA
# tuvo el <intent-filter> de "Compartir con esta app" en su
# AndroidManifest.xml -- porque ese intent-filter se genera a partir de
# twa-manifest.json, y twa-manifest.json nunca se enteró del cambio.
#
# QUÉ HACE ESTE SCRIPT:
# Compara `share_target` (pwa/manifest.json, fuente de verdad) contra
# `shareTarget` (twa-manifest.json, lo que bubblewrap realmente usa). Si
# difieren, escribe el valor correcto en twa-manifest.json y corre
# `bubblewrap update` para regenerar el proyecto Android (AndroidManifest.xml
# entre otros) ANTES de compilar. Si ya coinciden, no hace nada -- es
# seguro correrlo en cada build.
#
# Se invoca automáticamente desde build-apk.sh. También puede correrse a
# mano:
#   cd tango-cifrado-apk && ../scripts/apk/sync-share-target.sh
#
# Uso: sync-share-target.sh [directorio-apk]
#   Por defecto usa $PWD (asume que ya estás parado en tango-cifrado-apk/,
#   igual que el resto de scripts/apk/).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
APK_DIR="${1:-$PWD}"

# --- Guardia de seguridad post-M-5 ------------------------------------------
# Se descubrió que shareTarget en twa-manifest.json genera intent-filters
# (android.intent.action.SEND/SEND_MULTIPLE) que rompen la instalación en
# ciertos dispositivos Android ("There was a problem parsing the package").
# La causa raíz sigue sin identificarse (ver TO_FIX.md M-5). Mientras tanto,
# este script NUNCA vuelve a agregar shareTarget automáticamente aunque
# pwa/manifest.json lo tenga -- eso sería reintroducir el bug en silencio en
# cualquier build normal. Sí puede seguir QUITÁNDOLO si hiciera falta (esa
# dirección es segura). Para retomar la investigación de M-5 a propósito:
#   ALLOW_SHARE_TARGET=1 ../scripts/apk/sync-share-target.sh
ALLOW_SHARE_TARGET="${ALLOW_SHARE_TARGET:-0}"

PWA_MANIFEST="$REPO_ROOT/pwa/manifest.json"
TWA_MANIFEST="$APK_DIR/twa-manifest.json"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ ! -f "$PWA_MANIFEST" ]; then
  echo -e "${RED}❌ No se encontró $PWA_MANIFEST${NC}" >&2
  exit 1
fi

if [ ! -f "$TWA_MANIFEST" ]; then
  # No hay nada que sincronizar todavía: el próximo `bubblewrap init` va a
  # leer share_target directamente desde pwa/manifest.json.
  echo "ℹ️  $TWA_MANIFEST no existe todavía -- nada que sincronizar (bubblewrap init lo generará)."
  exit 0
fi

CHANGED_FLAG="$(mktemp)"
trap 'rm -f "$CHANGED_FLAG"' EXIT

python3 - "$PWA_MANIFEST" "$TWA_MANIFEST" "$CHANGED_FLAG" "$ALLOW_SHARE_TARGET" <<'PYEOF'
import json
import sys

pwa_path, twa_path, flag_path, allow_share_target = sys.argv[1:5]
allow_share_target = allow_share_target == "1"

with open(pwa_path) as f:
    pwa = json.load(f)
with open(twa_path) as f:
    twa = json.load(f)

pwa_share = pwa.get("share_target")
twa_share = twa.get("shareTarget")
changed = False

if pwa_share is None:
    if "shareTarget" in twa:
        del twa["shareTarget"]
        changed = True
else:
    # twa-manifest.json usa la MISMA forma que share_target del web
    # manifest (action/method/enctype/params), solo bajo la clave
    # camelCase `shareTarget` -- ver TwaManifest.verifyShareTarget en el
    # código fuente de bubblewrap, que copia share_target casi tal cual
    # (solo resuelve `action` a una URL absoluta, y la nuestra ya lo es).
    if twa_share != pwa_share and (twa_share is not None or allow_share_target):
        # twa_share is not None -> ya estaba habilitado, solo actualiza el
        # contenido (dirección segura). twa_share is None -> lo estamos
        # AGREGANDO por primera vez; solo permitido con ALLOW_SHARE_TARGET=1.
        twa["shareTarget"] = pwa_share
        changed = True
    elif twa_share is None and pwa_share is not None and not allow_share_target:
        print("⚠️  pwa/manifest.json tiene share_target pero twa-manifest.json no "
              "(removido a propósito, ver TO_FIX.md M-5). NO se re-agrega automáticamente. "
              "Usá ALLOW_SHARE_TARGET=1 si esto es intencional.", file=sys.stderr)

if changed:
    with open(twa_path, "w") as f:
        json.dump(twa, f, indent=2)
        f.write("\n")
    with open(flag_path, "w") as f:
        f.write("1")
PYEOF

if [ -s "$CHANGED_FLAG" ]; then
  echo -e "${YELLOW}🔄 share_target de pwa/manifest.json no coincidía con twa-manifest.json.${NC}"
  echo "   Actualizado. Corriendo 'bubblewrap update' para regenerar AndroidManifest.xml..."
  need() {
    if ! command -v "$1" >/dev/null 2>&1; then
      echo -e "${RED}❌ '$1' no está en \$PATH.${NC}" >&2
      exit 1
    fi
  }
  need bubblewrap
  ( cd "$APK_DIR" && bubblewrap update --skipVersionUpgrade )
  echo -e "${GREEN}✅ Proyecto Android regenerado con el share_target actual.${NC}"
else
  echo -e "${GREEN}✅ share_target ya está sincronizado en twa-manifest.json -- nada que regenerar.${NC}"
fi

