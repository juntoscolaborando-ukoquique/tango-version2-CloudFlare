"""
corpus.py — single adapter over the vendored private_core dependency.

This is the ONLY file in the public repo that imports from private_core.
All other Python code should import from here instead of reaching into
private_core directly. When the private repo's module layout changes,
only this file needs updating.

Requires private_core/ to be populated first:
    ./scripts/dev/setup_private_core.sh
"""
import os
import sys

# Ensure the project root is on sys.path so `private_core` is importable
# regardless of where Python is invoked from.
_PROJECT_ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

try:
    from private_core.cipher_engine import (  # noqa: F401
        cargar_tangos,
        cifrar_mensaje,
        descifrar_mensaje,
        iter_tangos,
        DEFAULT_SALT,
    )
except ModuleNotFoundError as exc:
    raise ModuleNotFoundError(
        "private_core not found. Run ./scripts/dev/setup_private_core.sh first."
    ) from exc

