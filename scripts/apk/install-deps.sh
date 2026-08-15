#!/usr/bin/env bash
# scripts/apk/install-deps.sh
#
# Instala los prerrequisitos para Bubblewrap / TWA:
#   - Node.js (>=20) via nvm (si no está)
#   - JDK 17+ (Ubuntu/Debian apt; en otros distros instalar manualmente)
#   - @bubblewrap/cli globalmente
#
# Uso:
#   chmod +x scripts/apk/install-deps.sh
#   ./scripts/apk/install-deps.sh
#
# Solo corre en Linux/macOS. En Windows, usar WSL2 o instalar manualmente.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_ok()   { echo -e "${GREEN}✅${NC} $*"; }
log_warn() { echo -e "${YELLOW}⚠️${NC}  $*"; }
log_err()  { echo -e "${RED}❌${NC} $*"; }
log_info() { echo -e "ℹ️  $*"; }

need_cmd() {
  if command -v "$1" >/dev/null 2>&1; then return 0; else return 1; fi
}

# Helper: ejecuta un comando como root. Usa `sudo` solo si existe y no somos
# root ya (uid != 0). Si somos root, corre el comando desnudo.
run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif need_cmd sudo; then
    sudo "$@"
  else
    echo "  -> No soy root y no existe 'sudo'. Intentando sin sudo (probablemente falle)..."
    "$@"
  fi
}

# Extrae el NÚMERO DE VERSIÓN MAYOR de Java de forma robusta.
# `java -version` escribe por stderr y el formato cambia mucho:
#   Oracle Java 8:  java version "1.8.0_381"              => mayor = 8
#   OpenJDK 11:    openjdk version "11.0.24" 2024-07-16  => mayor = 11
#   OpenJDK 17:    openjdk version "17.0.12" 2024-07-16  => mayor = 17
#   OpenJDK 21:    openjdk version "21.0.4" 2024-07-16   => mayor = 21
# El hack con sed greedy falla en JDK 2x (1er dígito se come al "2" y queda
# solo "1"); así que parseamos el token entero después de "version" y
# detectamos el caso especial "1.X" (Java 8 o anterior, X = versión real).
extract_java_major() {
  local raw token1
  raw="$(java -version 2>&1 | head -n1)"
  # token después de la palabra "version" (quita comillas)
  token1="$(echo "$raw" | grep -oE 'version[[:space:]]+"?[0-9.]+' | sed -E 's/^version[[:space:]]+"?//; s/\..*$//')"
  if [ -z "$token1" ]; then
    # fallback: cualquier número al final de la primera parte numérica
    token1="$(echo "$raw" | grep -oE '[0-9]+\.[0-9]+' | head -n1 | cut -d. -f1)"
  fi
  if [ "$token1" = "1" ]; then
    # Java 8 o menor: "1.8" = version mayor = 8 (segundo número)
    echo "$raw" | grep -oE '[0-9]+\.[0-9]+' | head -n1 | cut -d. -f2
  else
    echo "$token1"
  fi
}

echo "=============================================="
echo "  Instalando prerrequisitos TWA / Bubblewrap"
echo "=============================================="
echo

# ---------- Node.js ----------
if need_cmd node; then
  NODE_VER=$(node -v | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 20 ]; then
    log_ok "Node.js $NODE_VER ya instalado (>=20 OK)"
  else
    log_warn "Node.js $NODE_VER es demasiado viejo; necesita >=20. Instalando via nvm..."
    INSTALL_NVM=1
  fi
else
  log_warn "Node.js no encontrado. Instalando via nvm..."
  INSTALL_NVM=1
fi

if [ "${INSTALL_NVM:-0}" = "1" ]; then
  export NVM_DIR="$HOME/.nvm"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    log_info "Instalando nvm (Node Version Manager)..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  fi
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install 20
  nvm use 20
  nvm alias default 20
  log_ok "Node.js $(node -v) instalado via nvm"
fi

# ---------- npm ----------
if ! need_cmd npm; then
  log_err "npm no encontrado después de instalar Node. Abortando."
  exit 1
fi
log_ok "npm $(npm -v)"

# ---------- JDK ----------
if need_cmd java && need_cmd javac && need_cmd keytool; then
  JAVA_VER=$(extract_java_major)
  if [ "$JAVA_VER" -ge 17 ]; then
    log_ok "Java JDK $JAVA_VER ya instalado (>=17 OK)"
  else
    log_warn "Java JDK $JAVA_VER es demasiado viejo; necesita >=17."
    INSTALL_JDK=1
  fi
else
  log_warn "JDK incompleto o no encontrado (necesita java + javac + keytool)."
  INSTALL_JDK=1
fi

if [ "${INSTALL_JDK:-0}" = "1" ]; then
  log_info "Intentando instalar OpenJDK 17 via apt (Ubuntu/Debian)..."
  if need_cmd apt-get; then
    run_as_root apt-get update -qq
    run_as_root apt-get install -y -qq openjdk-17-jdk
    export JAVA_HOME=$(dirname $(dirname $(readlink -f $(which java))))
    log_ok "OpenJDK 17 instalado. JAVA_HOME=$JAVA_HOME"
  elif need_cmd brew; then
    brew install openjdk@17
    log_ok "OpenJDK 17 instalado via Homebrew."
  else
    log_err "No se detectó apt-get ni brew. Instalá JDK 17+ manualmente y volvé a correr."
    exit 1
  fi
fi

# ---------- Bubblewrap ----------
# Detección CORRECTA de Google's TWA CLI vs. /bin/bubblewrap (sandbox de Linux).
# El binario TWA CLI ES un script Node.js con shebang #!/usr/bin/env node.
# El binario bubblewrap del sistema es ELF (herramienta de LXC containers).
# Si encontramos uno pero NO es el CLI, lo marcamos como "no instalado" y npm lo
# instala en /usr/local/bin o el prefix que corresponda (prioritario en PATH).
TWA_BW_BIN=""
if need_cmd bubblewrap; then
  BW_PATH="$(command -v bubblewrap)"
  BW_HEAD="$(head -c 128 "$BW_PATH" 2>/dev/null || true)"
  case "$BW_HEAD" in
    "#!/usr/bin/env node"*)
      log_ok "TWA bubblewrap CLI ya instalado ($BW_PATH)"
      TWA_BW_BIN="$BW_PATH"
      ;;
    *)
      log_warn "'$BW_PATH' existe pero NO es el TWA CLI de Google (parece herramienta del sistema Linux). Instalando el CLI TWA de npm..."
      TWA_BW_BIN=""
      ;;
  esac
fi
if [ -z "$TWA_BW_BIN" ]; then
  log_info "Instalando @bubblewrap/cli globalmente via npm..."
  npm install -g @bubblewrap/cli --no-audit --no-fund
  hash -r  # refresh command hash table
  TWA_BW_BIN="$(command -v bubblewrap || true)"
  log_ok "@bubblewrap/cli instalado globalmente ($TWA_BW_BIN)"
fi

echo
echo "=============================================="
log_ok "Dependencias instaladas. Estado actual:"

# Pequeño resumen del repo — si ya hay artefactos (keystore, assetlinks,
# twa-manifest.json) evitamos recomendar pasos que ya están hechos.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APK_DIR="$REPO_ROOT/tango-cifrado-apk"
EXISTEN_ARTIFACTOS=0
[ -f "$APK_DIR/android.keystore" ] && { log_ok "   • android.keystore  YA EXISTE (paso de generación ya hecho)"; EXISTEN_ARTIFACTOS=1; }
[ -f "$APK_DIR/twa-manifest.json" ] && { log_ok "   • twa-manifest.json YA EXISTE (paso bubblewrap init ya hecho)"; EXISTEN_ARTIFACTOS=1; }
[ -f "$REPO_ROOT/.well-known/assetlinks.json" ] && { log_ok "   • assetlinks.json    YA EXISTE (Digital Asset Links ya generado)"; EXISTEN_ARTIFACTOS=1; }

echo
if [ "$EXISTEN_ARTIFACTOS" = "1" ]; then
  echo " 👉 Ya tenés los artefactos de identidad listos. Siguiente paso DIRECTO:"
  echo "     cd tango-cifrado-apk/"
  echo "     ../scripts/apk/build-apk.sh   (genera el APK en ../dist/apk/)"
  echo
  echo "    (antes, asegurate de haber publicado los assetlinks.json en el repo público"
  echo "     y verificado con Google: https://developers.google.com/digital-asset-links/tools/generator)"
else
  echo " 👉 Siguientes pasos:"
  echo "     1. cd tango-cifrado-apk/"
  echo "     2. ../scripts/apk/generate-keystore.sh   (UNA SOLA VEZ — BACKUP OBLIGATORIO)"
  echo "     3. bubblewrap init --manifest=https://misbusquedaspersonales-cyber.github.io/tango_cipher_bot_public/pwa/manifest.json"
  echo "     4. ../scripts/apk/generate-assetlinks.sh → copiar a .well-known/assetlinks.json → push"
  echo "     5. ../scripts/apk/build-apk.sh"
fi
echo "=============================================="

