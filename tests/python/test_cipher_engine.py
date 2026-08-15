import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from private_core.cipher_engine import cifrar_mensaje, descifrar_mensaje, iter_tangos, DEFAULT_SALT

# Corpus mínimo autocontenido — sin dependencia de tangos.json en disco
BASE = {
    "3": {
        "titulo": "Cambalache",
        "versos": [
            ["Que", "el", "mundo", "fue", "y", "será", "una", "porquería", "ya", "lo", "sé"],
            ["mañana", "subir", "este", "artículo", "que", "te", "di", "ayer"],
        ]
    }
}
SALT = DEFAULT_SALT  # 47


# --- cifrar_mensaje ---

def test_cifrar_palabra_en_corpus():
    resultado = cifrar_mensaje("3", "el mundo", BASE)
    assert resultado.startswith("50-")
    assert "V01P02" in resultado  # "el" -> verso 1, palabra 2
    assert "V01P03" in resultado  # "mundo" -> verso 1, palabra 3


def test_cifrar_palabra_fuera_de_corpus_usa_xor_hex():
    resultado = cifrar_mensaje("3", "magnifico", BASE)
    tokens = resultado.split("-")
    fallback = tokens[1]
    assert fallback.startswith("#")
    # The fallback is now PBKDF2-derived — verify via round-trip, not manual XOR
    assert descifrar_mensaje(resultado, BASE) == "magnifico"


def test_fallback_keystream_depende_del_contexto_del_mensaje():
    resultado_a = cifrar_mensaje("3", "hola magnifico", BASE)
    resultado_b = cifrar_mensaje("3", "mundo magnifico", BASE)
    assert resultado_a.split("-")[3] != resultado_b.split("-")[3]


def test_cifrar_mensaje_mixto():
    resultado = cifrar_mensaje("3", "el magnifico", BASE)
    tokens = resultado.split("-")
    assert tokens[1] == "V01P02"       # "el" en corpus
    assert tokens[2] == "~20"          # espacio
    assert tokens[3].startswith("#")   # "magnifico" fuera del corpus


def test_cifrar_id_invalido_lanza_error():
    with pytest.raises(ValueError, match="no encontrado"):
        cifrar_mensaje("99", "hola", BASE)


def test_cifrar_mensaje_vacio():
    resultado = cifrar_mensaje("3", "", BASE)
    assert resultado == "50-"


# --- Round-trip exacto (capitalización + puntuación) ---

def test_round_trip_minusculas():
    msg = "el mundo"
    assert descifrar_mensaje(cifrar_mensaje("3", msg, BASE), BASE) == msg


def test_round_trip_primera_mayuscula():
    msg = "El mundo"
    assert descifrar_mensaje(cifrar_mensaje("3", msg, BASE), BASE) == msg


def test_round_trip_todo_mayusculas():
    msg = "EL MUNDO"
    assert descifrar_mensaje(cifrar_mensaje("3", msg, BASE), BASE) == msg


def test_round_trip_puntuacion():
    msg = "el mundo, fue y será."
    assert descifrar_mensaje(cifrar_mensaje("3", msg, BASE), BASE) == msg


def test_round_trip_mixto_completo():
    msg = "Mañana subir este Artículo, que te di ayer."
    assert descifrar_mensaje(cifrar_mensaje("3", msg, BASE), BASE) == msg


def test_round_trip_fallback_xor():
    msg = "magnifico"
    assert descifrar_mensaje(cifrar_mensaje("3", msg, BASE), BASE) == msg


def test_round_trip_fallback_con_mayuscula():
    msg = "Magnifico"
    assert descifrar_mensaje(cifrar_mensaje("3", msg, BASE), BASE) == msg


def test_round_trip_signos_especiales():
    msg = "¿Cómo estás?"
    assert descifrar_mensaje(cifrar_mensaje("3", msg, BASE), BASE) == msg


# --- SALT personalizado ---

def test_salt_personalizado_produce_clave_diferente():
    r47 = cifrar_mensaje("3", "el", BASE, salt=47)
    r10 = cifrar_mensaje("3", "el", BASE, salt=10)
    assert r47.split("-")[0] == "50"
    assert r10.split("-")[0] == "13"


def test_salt_personalizado_round_trip():
    msg = "El mundo, magnifico."
    salt = 13
    assert descifrar_mensaje(cifrar_mensaje("3", msg, BASE, salt=salt), BASE, salt=salt) == msg


# --- Formato ---

def test_formato_coordenadas_dos_digitos():
    resultado = cifrar_mensaje("3", "el", BASE)
    token = resultado.split("-")[1]
    assert token == "V01P02"


def test_clave_invalida_lanza_error():
    with pytest.raises(ValueError):
        descifrar_mensaje("999-V01P01", BASE)


# --- Manejo defensivo de entradas malformadas ---

def test_descifrar_mensaje_vacio_lanza_error():
    with pytest.raises(ValueError, match="inválido"):
        descifrar_mensaje("", BASE)

def test_descifrar_sin_guion_lanza_error():
    with pytest.raises(ValueError, match="inválido"):
        descifrar_mensaje("50V01P01", BASE)

def test_descifrar_clave_no_numerica_lanza_error():
    with pytest.raises(ValueError, match="número"):
        descifrar_mensaje("abc-V01P01", BASE)

def test_descifrar_verso_fuera_de_rango_lanza_error():
    coded = cifrar_mensaje("3", "el", BASE)
    # Patch the token to reference a non-existent verse
    corrupted = coded.replace("V01P02", "V99P01")
    with pytest.raises(ValueError, match="verso"):
        descifrar_mensaje(corrupted, BASE)

def test_descifrar_palabra_fuera_de_rango_lanza_error():
    coded = cifrar_mensaje("3", "el", BASE)
    corrupted = coded.replace("V01P02", "V01P99")
    with pytest.raises(ValueError, match="palabra"):
        descifrar_mensaje(corrupted, BASE)

def test_descifrar_token_malformado_lanza_error():
    with pytest.raises(ValueError, match="malformado"):
        descifrar_mensaje("50-INVALID", BASE)

def test_descifrar_hex_malformado_lanza_error():
    with pytest.raises(ValueError, match="malformado"):
        descifrar_mensaje("50-#xyz", BASE)


# --- Dígitos agrupados (no un token hex por carácter) ---

def test_digitos_consecutivos_un_solo_token():
    resultado = cifrar_mensaje("3", "el 15:30", BASE)
    # 'el' esta en el corpus, ':' es puntuacion, '15' y '30' son dos
    # corridas de digitos -> deben producir exactamente 2 tokens '#...',
    # no uno por cada caracter numerico.
    assert resultado.count("#") == 2


def test_round_trip_digitos_consecutivos():
    msg = "reunion a las 15:30 en la calle 8"
    assert descifrar_mensaje(cifrar_mensaje("3", msg, BASE), BASE) == msg


# --- SALT vía variable de entorno CIFRADO_SALT ---

def test_salt_desde_variable_de_entorno():
    os.environ["CIFRADO_SALT"] = "99"
    try:
        resultado = cifrar_mensaje("3", "el", BASE)  # sin kwarg salt
        assert resultado.split("-")[0] == str(3 + 99)
        assert descifrar_mensaje(resultado, BASE) == "el"
    finally:
        del os.environ["CIFRADO_SALT"]


def test_salt_explicito_tiene_prioridad_sobre_entorno():
    os.environ["CIFRADO_SALT"] = "99"
    try:
        resultado = cifrar_mensaje("3", "el", BASE, salt=5)
        assert resultado.split("-")[0] == "8"
    finally:
        del os.environ["CIFRADO_SALT"]


def test_sin_variable_de_entorno_usa_default_salt():
    resultado = cifrar_mensaje("3", "el", BASE)
    assert resultado.split("-")[0] == str(3 + DEFAULT_SALT)


# --- iter_tangos salta claves de metadata ---

def test_iter_tangos_salta_metadata():
    base_con_metadata = dict(BASE)
    base_con_metadata["_nota"] = "esto no es un tango"
    ids = [clave for clave, _ in iter_tangos(base_con_metadata)]
    assert "_nota" not in ids
    assert ids == ["3"]


def test_cifrar_rechaza_clave_de_metadata():
    base_con_metadata = dict(BASE)
    base_con_metadata["_nota"] = "esto no es un tango"
    with pytest.raises(ValueError):
        cifrar_mensaje("_nota", "hola", base_con_metadata)


# ---------- shared cross-engine vectors (P3-6) ----------

import json
from pathlib import Path

_VECTORS = json.loads((Path(__file__).parent.parent / "vectors.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", _VECTORS["cases"], ids=lambda c: c["name"])
def test_shared_vector(case):
    """Assert Python engine agrees with tests/vectors.json (generated from JS engine).

    Deterministic cases: exact ciphertext match.
    roundtrip_only cases: encrypt→decrypt must reproduce the original message.
    error cases: cifrar_mensaje must raise ValueError.
    """
    corpus = _VECTORS["corpus"]
    salt = _VECTORS["salt"]

    if case.get("error"):
        with pytest.raises(ValueError):
            cifrar_mensaje(case["id_tango"], case["mensaje"], corpus, salt=salt)
        return

    cifrado = cifrar_mensaje(case["id_tango"], case["mensaje"], corpus, salt=salt)

    if case.get("roundtrip_only"):
        resultado = descifrar_mensaje(cifrado, corpus, salt=salt)
        assert resultado == case["mensaje"], (
            f"Round-trip failed for vector '{case['name']}': "
            f"encrypt produced {cifrado!r}, decrypt produced {resultado!r}, "
            f"expected {case['mensaje']!r}"
        )
        return

    assert cifrado == case["ciphertext"], (
        f"Python cifrar_mensaje diverged from tests/vectors.json for "
        f"'{case['name']}': got {cifrado!r}, expected {case['ciphertext']!r}. "
        "If the wire format changed intentionally, regenerate vectors.json and "
        "update pwa/cipherEngine.js in the same commit."
    )

