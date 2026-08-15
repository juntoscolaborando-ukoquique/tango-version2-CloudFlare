#!/usr/bin/env bash
#
# setup_private_core.sh
#
# Clones the private repo (cipher_engine.py + tangos.json) into
# private_core/, pinned to a specific commit SHA — not `main`.
#
# WHY PINNED, NOT `main`: main.py imports from private_core/ at runtime.
# If this script always pulled the latest `main` of the private repo, a
# change to cipher_engine.py's function signature (or anything else) would
# silently change what main.py runs the next time someone re-runs setup —
# no code review, no diff, no warning. Pinning to a SHA means the public
# repo's behavior only changes when a human deliberately bumps
# PRIVATE_CORE_COMMIT below and commits that change.
#
# Usage:
#   ./scripts/setup_private_core.sh
#
# Requires: git, and read access to the private repo (SSH key or a PAT
# with repo scope on your git credential helper — this script does not
# handle auth itself).

set -euo pipefail

# --- fill these in for your own setup ---
PRIVATE_REPO_URL="https://github.com/misbusquedaspersonales-cyber/tango_corpus_private.git"
PRIVATE_CORE_COMMIT="c14366ba53f679ecf1e747e62ca49f46ad5d2e04"
# -----------------------------------------

TARGET_DIR="private_core"

if [ "$PRIVATE_CORE_COMMIT" = "<pegar-sha-de-commit-aca>" ]; then
  echo "ERROR: editá este script y fijá PRIVATE_CORE_COMMIT a un commit SHA real del repo privado." >&2
  echo "       (git log en el repo privado -> copiá el SHA del commit que querés usar)" >&2
  exit 1
fi

if [ -d "$TARGET_DIR" ]; then
  echo "ERROR: $TARGET_DIR ya existe. Borralo primero si querés re-clonar:" >&2
  echo "       rm -rf $TARGET_DIR" >&2
  exit 1
fi

echo "Clonando $PRIVATE_REPO_URL en $TARGET_DIR ..."
git clone "$PRIVATE_REPO_URL" "$TARGET_DIR"

echo "Fijando a commit pinneado: $PRIVATE_CORE_COMMIT ..."
git -C "$TARGET_DIR" checkout --quiet "$PRIVATE_CORE_COMMIT"

# Detach from the remote entirely -- this is a vendored snapshot, not a
# live checkout. Removing .git avoids someone accidentally running
# `git pull` inside private_core/ and silently moving off the pinned SHA.
rm -rf "$TARGET_DIR/.git"

# Belt-and-suspenders: confirm .gitignore actually covers this before
# finishing, so setup fails loudly instead of leaving you exposed.
if ! git check-ignore -q "$TARGET_DIR" 2>/dev/null; then
  echo "ERROR: $TARGET_DIR NO está cubierto por .gitignore. No continúes -- revisá .gitignore antes de tocar git add." >&2
  exit 1
fi

echo "OK -- $TARGET_DIR listo, pinneado a $PRIVATE_CORE_COMMIT, y confirmado en .gitignore."

