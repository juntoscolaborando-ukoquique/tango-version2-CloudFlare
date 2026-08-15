#!/usr/bin/env bash
# scripts/apk/generate-keystore.sh
#
# Genera la keystore de firma para la TWA. CORRER UNA SOLA VEZ.
#
# ⚠️  IMPORTANTE — DÓNDE CORRER ESTE SCRIPT:
#   NO lo corras desde dentro del workspace del repo si existe alguna
#   herramienta que genera exports del workspace (Tango_compact.txt u
#   otro dump). Esas herramientas leen el filesystem directamente sin
#   respetar .gitignore, y van a exponer android.keystore y
#   keystore-password.txt en el próximo export.
#
#   Correlo desde FUERA del workspace:
#     mkdir -p ~/tango-signing
#     cd ~/tango-signing
#     /ruta/al/repo/scripts/apk/generate-keystore.sh
#
#   Por defecto escribe android.keystore + keystore-password.txt en
#   ~/tango-signing/ cuando se corre desde fuera del workspace.
#
# SEGURIDAD: si en algún momento tu android.keystore o keystore-password.txt
# aparecieron en un export/dump/log fuera de tu máquina (sandbox, chat, CI
# log), tratalos como comprometidos y volvé a correr este script desde cero
# FUERA del workspace.
#
# Después de correr este script:
#   1. Hacé BACKUP de android.keystore + su contraseña en un lugar seguro.
#      Si perdés la keystore, no podés publicar updates bajo la misma
#      identidad de app.
#   2. Corré generate-assetlinks.sh para obtener el SHA-256 y el assetlinks.json.
#
# Uso (desde dentro de tango-cifrado-apk/):
#   ../scripts/apk/generate-keystore.sh
# O desde la raíz del repo:
#   ./scripts/apk/generate-keystore.sh
#
# Variables de entorno opcionales para modo no-interactivo (CI):
#   KEYSTORE_ALIAS    default: android
#   KEYSTORE_DNAME    default: "CN=Tango Cifrado, OU=Dev, O=TangoCifrado, L=Buenos Aires, ST=CABA, C=AR"
#   KEYSTORE_PASS     si está seteada, no pregunta interactivamente (⚠️  solo en CI/entorno privado!)
#   KEYSTORE_KEY_PASS si es distinta de KEYSTORE_PASS; default = igual que KEYSTORE_PASS

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

KNOWN_COMPROMISED_PASSWORDS=(
  "TangoCifrado-Sandbox-2026!"   # sandbox keystore, hardcoded in _runall_sandbox.sh
  "SeVestiraDeFiesta"            # second keystore, leaked via workspace export tool
)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Output directory: prefer ~/tango-signing/ (outside the workspace, safe from
# export tools) unless we're already sitting inside tango-cifrado-apk/.
if [ -f "$PWD/twa-config.json" ] && [ "$(basename "$PWD")" = "tango-cifrado-apk" ]; then
  APK_DIR="$PWD"
  echo -e "${YELLOW}⚠️  Corriendo desde dentro del workspace — android.keystore y"
  echo -e "   keystore-password.txt quedarán en $APK_DIR"
  echo -e "   Si existe una herramienta de export del workspace, van a leakear."
  echo -e "   Considerá correr desde ~/tango-signing/ en su lugar.${NC}"
else
  APK_DIR="${SIGNING_DIR:-$HOME/tango-signing}"
  mkdir -p "$APK_DIR"
  echo -e "${GREEN}✅ Generando keystore fuera del workspace en: $APK_DIR${NC}"
fi

KEYSTORE_FILE="$APK_DIR/android.keystore"
PASS_FILE="$APK_DIR/keystore-password.txt"

ALIAS="${KEYSTORE_ALIAS:-android}"
DNAME="${KEYSTORE_DNAME:-CN=Tango Cifrado, OU=Dev, O=TangoCifrado, L=Buenos Aires, ST=CABA, C=AR}"


if ! command -v keytool >/dev/null 2>&1; then
  echo -e "${RED}❌ keytool no encontrado. Instalá JDK 17+ primero: ${YELLOW}../scripts/apk/install-deps.sh${NC}"
  exit 1
fi

if [ -f "$KEYSTORE_FILE" ]; then
  echo -e "${YELLOW}⚠️  $KEYSTORE_FILE ya existe. No la voy a sobreescribir (perderías la identidad de firma).${NC}"
  echo "   Si querés regenerarla, borrala manualmente antes y volvé a correr."
  echo
  echo "   SHA-256 actual:"
  keytool -list -v -keystore "$KEYSTORE_FILE" -alias "$ALIAS" 2>/dev/null \
    | grep -E "^\s*SHA256:" || true
  exit 0
fi

mkdir -p "$APK_DIR"

if [ -z "${KEYSTORE_PASS:-}" ]; then
  echo
  echo "============================================================"
  echo -e "  ${GREEN}Generando keystore de firma para TWA${NC}"
  echo "============================================================"
  echo
  echo -e "${YELLOW}⚠️  IMPORTANTE: la contraseña que elijas a continuación NO se${NC}"
  echo -e "${YELLOW}   puede recuperar. Guardala junto al archivo .keystore en${NC}"
  echo -e "${YELLOW}   un backup CIFRADO. Si perdés cualquiera de las dos cosas,${NC}"
  echo -e "${YELLOW}   no podés publicar updates futuros bajo el mismo package${NC}"
  echo -e "${YELLOW}   name — habría que distribuir un APK totalmente nuevo.${NC}"
  echo
  read -r -s -p "Contraseña de keystore (>=6 chars): " KS_PASS
  echo
  read -r -s -p "Repetir contraseña:               " KS_PASS2
  echo
  if [ "$KS_PASS" != "$KS_PASS2" ]; then
    echo -e "${RED}❌ Las contraseñas no coinciden.${NC}"
    exit 1
  fi
  if [ "${#KS_PASS}" -lt 6 ]; then
    echo -e "${RED}❌ Contraseña demasiado corta (mínimo 6 caracteres).${NC}"
    exit 1
  fi
else
  KS_PASS="$KEYSTORE_PASS"
  echo -e "${YELLOW}⚠️  Usando contraseña desde variable KEYSTORE_PASS (modo CI).${NC}"
  for bad in "${KNOWN_COMPROMISED_PASSWORDS[@]}"; do
    if [ "$KS_PASS" = "$bad" ]; then
      echo -e "${RED}❌ Esa contraseña quedó expuesta en un export previo y está"
      echo -e "   marcada como comprometida en este script. Elegí otra.${NC}"
      exit 1
    fi
  done
fi

KS_KEY_PASS="${KEYSTORE_KEY_PASS:-$KS_PASS}"

echo
echo "Ejecutando: keytool -genkeypair -v -keystore android.keystore -alias $ALIAS -keyalg RSA -keysize 2048 -validity 10000 ..."
keytool -genkeypair \
  -v \
  -keystore "$KEYSTORE_FILE" \
  -alias "$ALIAS" \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storepass "$KS_PASS" \
  -keypass "$KS_KEY_PASS" \
  -dname "$DNAME"

echo -e "${GREEN}✅ Keystore generada en:${NC} $KEYSTORE_FILE"

# Guardar contraseña en un archivo .gitignore-ado para que generate-assetlinks.sh
# y build-apk.sh puedan leerla sin volver a preguntar.
echo -n "$KS_PASS" > "$PASS_FILE"
chmod 600 "$PASS_FILE"
echo -e "${GREEN}✅ Contraseña guardada en:${NC} $PASS_FILE (modo 0600, en .gitignore)"

echo
echo "============================================================"
echo -e "  ${GREEN}BACKUP OBLIGATORIO${NC}"
echo "============================================================"
echo "   Copiá ESTOS DOS archivos a un lugar seguro AHORA:"
echo "     • $KEYSTORE_FILE"
echo "     • la contraseña (guardala en tu gestor, no solo en $PASS_FILE)"
echo
echo -e "   ${RED}Si perdés la keystore + pass → NUNCA MÁS podés publicar updates${NC}"
echo -e "   ${RED}bajo la misma identidad de app (com.tangocifrado.app).${NC}"
echo
echo "Siguiente paso: ../scripts/apk/generate-assetlinks.sh"

