import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts", "ci"))

from build_encrypted_bundle import construir_bundle  # noqa: E402
from decrypt_bundle_cli import descifrar_bundle  # noqa: E402

TANGOS_MINIMOS = {
    "3": {
        "titulo": "Cambalache",
        "versos": [["Que", "el", "mundo", "fue"]],
    }
}


@pytest.fixture
def tangos_path(tmp_path):
    p = tmp_path / "tangos.json"
    p.write_text(json.dumps(TANGOS_MINIMOS, ensure_ascii=False), encoding="utf-8")
    return str(p)


def test_round_trip_con_clave_correcta(tangos_path):
    bundle = construir_bundle(tangos_path, tango_salt=47, clave_despliegue="clave-de-prueba-bien-larga-123")
    resultado = descifrar_bundle(bundle, "clave-de-prueba-bien-larga-123")
    assert resultado["salt"] == 47
    assert resultado["tangos"] == TANGOS_MINIMOS


def test_clave_incorrecta_falla(tangos_path):
    bundle = construir_bundle(tangos_path, tango_salt=47, clave_despliegue="clave-correcta-123456789")
    with pytest.raises(ValueError, match="incorrecta|corrompido"):
        descifrar_bundle(bundle, "clave-incorrecta")


def test_bundle_manipulado_falla(tangos_path):
    bundle = construir_bundle(tangos_path, tango_salt=47, clave_despliegue="clave-correcta-123456789")
    # Flip a character in the ciphertext -- GCM tag check must reject this,
    # not silently decrypt to garbage.
    b64 = bundle["ciphertext_b64"]
    tampered = ("A" if b64[0] != "A" else "B") + b64[1:]
    bundle["ciphertext_b64"] = tampered
    with pytest.raises(ValueError, match="incorrecta|corrompido"):
        descifrar_bundle(bundle, "clave-correcta-123456789")


def test_nonce_es_distinto_en_cada_build(tangos_path):
    b1 = construir_bundle(tangos_path, tango_salt=47, clave_despliegue="misma-clave-123456789")
    b2 = construir_bundle(tangos_path, tango_salt=47, clave_despliegue="misma-clave-123456789")
    assert b1["nonce_b64"] != b2["nonce_b64"], "el nonce debe ser único en cada ejecución"
    assert b1["kdf_salt_b64"] != b2["kdf_salt_b64"], "el KDF salt debe ser único en cada ejecución"


def test_salt_del_tango_viaja_correctamente(tangos_path):
    bundle = construir_bundle(tangos_path, tango_salt=99, clave_despliegue="clave-de-prueba-123456789")
    resultado = descifrar_bundle(bundle, "clave-de-prueba-123456789")
    assert resultado["salt"] == 99

