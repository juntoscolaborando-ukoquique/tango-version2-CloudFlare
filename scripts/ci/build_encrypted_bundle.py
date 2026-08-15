#!/usr/bin/env python3
"""
build_encrypted_bundle.py

Runs in the PRIVATE repo's CI (GitHub Action). Takes the private tangos.json
and the tango-ID-masking offset (referred to elsewhere in this project as
"SALT"), encrypts them together with AES-256-GCM under a key derived from
CLAVE_DESPLIEGUE, and writes a public-safe encrypted bundle that gets shipped
to the PUBLIC repo (GitHub Pages / PWA static assets).

IMPORTANT — TWO COPIES EXIST:
  - Private repo: scripts/build_encrypted_bundle.py  ← runs in production CI
  - Public repo:  scripts/ci/build_encrypted_bundle.py  ← reference copy for local tests

The workflow's `run:` commands reference the private repo's path. If you edit
this public copy, apply the same change to the private repo's copy. They must
stay in sync or the next CI run will produce a bundle from stale logic.

Design notes (read before changing anything):

- KDF: PBKDF2-HMAC-SHA256, not Argon2id/scrypt. This is a deliberate choice,
  not an oversight: the browser-side decryption uses the Web Crypto API
  (SubtleCrypto), which only supports PBKDF2 for password-based key
  derivation without pulling in a WASM library. Using the same KDF on both
  ends means no extra client-side dependency. If you later add a WASM
  Argon2id implementation client-side (e.g. hash-wasm), swap both ends
  together -- don't let them drift.

- Iteration count: 600,000 is OWASP's current (2023+) minimum recommendation
  for PBKDF2-HMAC-SHA256. Because this bundle is public and static, an
  attacker gets unlimited offline guesses against it -- there is no
  rate-limiting. CLAVE_DESPLIEGUE MUST be high-entropy (treat it like a
  generated API key, e.g. `openssl rand -base64 32`), not a memorable
  passphrase. The iteration count slows down each guess; it does not
  compensate for a weak secret.

- AES-GCM nonce: a fresh random 12-byte nonce is generated on every run and
  stored alongside the ciphertext. NEVER hardcode or reuse a nonce with the
  same key -- doing so breaks GCM's confidentiality and integrity guarantees
  completely. Because we derive a fresh key from a fresh KDF salt on every
  run too, nonce reuse across deploys is a non-issue as long as this script
  keeps generating both randomly (it does, via `secrets`/`os.urandom`).

- Authenticated data (AAD): bound to a fixed version string so a bundle
  produced by a different format/version can't be silently swapped in and
  decrypt "successfully" against mismatched client code.

- The GCM tag is verified automatically on decrypt (by both the `cryptography`
  library here and by SubtleCrypto client-side) -- if the blob is corrupted
  or tampered with, decryption raises/rejects instead of returning garbage.

Usage (in CI):
    CLAVE_DESPLIEGUE=<secret> python3 scripts/build_encrypted_bundle.py \\
        --tangos tangos.json \\
        --salt 47 \\
        --out pwa/encrypted-bundle.json
"""
import argparse
import base64
import hashlib
import json
import os
import secrets
import sys
import unicodedata
from datetime import datetime, timezone

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

KDF_NAME = "PBKDF2-HMAC-SHA256"
KDF_ITERATIONS = 600_000
KDF_SALT_LEN = 16     # bytes -- this is the KDF's own salt, unrelated to
                       # the project's tango-ID-masking "SALT" (confusing
                       # naming collision from earlier in the project; kept
                       # the tango one as "salt" in the payload for
                       # continuity, and call this one "kdf_salt" throughout).
NONCE_LEN = 12         # bytes, standard for AES-GCM
KEY_LEN = 32           # bytes -> AES-256
AAD = b"tango-cifrado-bundle-v1"


def derivar_clave(clave_despliegue: str, kdf_salt: bytes) -> bytes:
    clave_nfkc = unicodedata.normalize("NFKC", clave_despliegue)
    return hashlib.pbkdf2_hmac(
        "sha256",
        clave_nfkc.encode("utf-8"),
        kdf_salt,
        KDF_ITERATIONS,
        dklen=KEY_LEN,
    )


def resolver_ruta_tangos(tangos_path: str) -> str:
    if os.path.exists(tangos_path):
        return tangos_path

    fallback = os.path.join(os.path.dirname(__file__), "..", "..", "private_core", "tangos.json")
    if os.path.exists(fallback):
        return fallback

    return tangos_path


def construir_bundle(tangos_path: str, tango_salt: int, clave_despliegue: str) -> dict:
    ruta_real = resolver_ruta_tangos(tangos_path)
    with open(ruta_real, "r", encoding="utf-8") as f:
        tangos = json.load(f)

    payload = json.dumps({"tangos": tangos, "salt": tango_salt}, ensure_ascii=False).encode("utf-8")

    kdf_salt = secrets.token_bytes(KDF_SALT_LEN)
    nonce = secrets.token_bytes(NONCE_LEN)
    key = derivar_clave(clave_despliegue, kdf_salt)

    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, payload, AAD)  # tag is appended automatically

    return {
        "version": 1,
        "kdf": KDF_NAME,
        "kdf_iterations": KDF_ITERATIONS,
        "kdf_salt_b64": base64.b64encode(kdf_salt).decode("ascii"),
        "nonce_b64": base64.b64encode(nonce).decode("ascii"),
        "ciphertext_b64": base64.b64encode(ciphertext).decode("ascii"),
        "aad": AAD.decode("ascii"),
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tangos", default="tangos.json", help="Path to the private tangos.json")
    parser.add_argument("--salt", type=int, required=True, help="Tango-ID-masking offset (the project's SALT)")
    parser.add_argument("--out", default="pwa/encrypted-bundle.json", help="Output path for the encrypted bundle")
    args = parser.parse_args()

    clave_despliegue = os.environ.get("CLAVE_DESPLIEGUE")
    if not clave_despliegue:
        print("ERROR: CLAVE_DESPLIEGUE no está definida en el entorno.", file=sys.stderr)
        sys.exit(1)
    if len(clave_despliegue) < 20:
        print(
            "ADVERTENCIA: CLAVE_DESPLIEGUE tiene menos de 20 caracteres. "
            "Este blob es público y un atacante puede probar contraseñas offline "
            "sin límite -- usa un secreto de alta entropía "
            "(ej: `openssl rand -base64 32`), no una frase memorizable.",
            file=sys.stderr,
        )

    bundle = construir_bundle(args.tangos, args.salt, clave_despliegue)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(bundle, f, indent=2)

    print(f"Bundle cifrado escrito en: {args.out}")
    print(f"KDF: {bundle['kdf']} ({bundle['kdf_iterations']} iteraciones)")


if __name__ == "__main__":
    main()

