#!/usr/bin/env python3
"""
decrypt_bundle_cli.py

Dev/CI utility: decrypts a bundle produced by build_encrypted_bundle.py, to
verify the CI step actually produced something valid before it gets shipped
to the public repo. NOT meant to run in the browser -- that side uses
SubtleCrypto in secure-vault.js. This mirrors that logic in Python so you
can smoke-test the pipeline with `pytest` or a CI step without a browser.

IMPORTANT — TWO COPIES EXIST:
  - Private repo: scripts/decrypt_bundle_cli.py  ← runs in production CI
  - Public repo:  scripts/ci/decrypt_bundle_cli.py  ← reference copy for local tests

If you edit this public copy, apply the same change to the private repo's copy.

Usage:
    CLAVE_DESPLIEGUE=<secret> python3 scripts/decrypt_bundle_cli.py pwa/encrypted-bundle.json
"""
import base64
import hashlib
import json
import os
import sys
import unicodedata

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.exceptions import InvalidTag

KEY_LEN = 32


def descifrar_bundle(bundle: dict, clave_despliegue: str) -> dict:
    kdf_salt = base64.b64decode(bundle["kdf_salt_b64"])
    nonce = base64.b64decode(bundle["nonce_b64"])
    ciphertext = base64.b64decode(bundle["ciphertext_b64"])
    aad = bundle["aad"].encode("ascii")

    clave_nfkc = unicodedata.normalize("NFKC", clave_despliegue)
    key = hashlib.pbkdf2_hmac(
        "sha256",
        clave_nfkc.encode("utf-8"),
        kdf_salt,
        bundle["kdf_iterations"],
        dklen=KEY_LEN,
    )

    aesgcm = AESGCM(key)
    try:
        payload = aesgcm.decrypt(nonce, ciphertext, aad)
    except InvalidTag:
        raise ValueError(
            "No se pudo descifrar: CLAVE_DESPLIEGUE incorrecta, o el bundle "
            "fue corrompido/alterado (falló la verificación del tag GCM)."
        )

    return json.loads(payload.decode("utf-8"))


def main():
    if len(sys.argv) != 2:
        print("Uso: decrypt_bundle_cli.py <ruta-al-bundle.json>", file=sys.stderr)
        sys.exit(1)

    clave_despliegue = os.environ.get("CLAVE_DESPLIEGUE")
    if not clave_despliegue:
        print("ERROR: CLAVE_DESPLIEGUE no está definida en el entorno.", file=sys.stderr)
        sys.exit(1)

    with open(sys.argv[1], "r", encoding="utf-8") as f:
        bundle = json.load(f)

    resultado = descifrar_bundle(bundle, clave_despliegue)
    tangos_reales = sum(1 for k in resultado["tangos"] if not k.startswith("_"))
    print(f"OK -- {tangos_reales} tangos, salt={resultado['salt']}")


if __name__ == "__main__":
    main()

