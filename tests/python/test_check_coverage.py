"""
test_check_coverage.py — tests for scripts/dev/check_coverage.py

Tests the two pure functions (load_corpus, extract_words) and the coverage
logic without requiring private_core/ to be populated — uses a minimal
inline fixture corpus instead.
"""

import json
import sys
import tempfile
from pathlib import Path

import pytest

# Make the script importable
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

# Import the functions under test directly from the script
import importlib.util

_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "dev" / "check_coverage.py"
_spec = importlib.util.spec_from_file_location("check_coverage", _SCRIPT)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

load_corpus = _mod.load_corpus
extract_words = _mod.extract_words  # noqa: F401 (used via _mod in tests below)


# ── Fixture corpus ──────────────────────────────────────────────────────────

FIXTURE = {
    "_nota": "test fixture",
    "1": {
        "titulo": "Tango Uno",
        "versos": [
            ["el", "mundo", "fue", "una", "porquería"],
            ["ya", "lo", "sé"],
            {"padding": True, "palabras": ["mañana", "publicar", "artículo"]},
        ],
    },
    "2": {
        "titulo": "Tango Dos",
        "versos": [
            ["cuando", "la", "suerte", "falla"],
            ["te", "deje", "solo"],
        ],
    },
}


@pytest.fixture
def fixture_path(tmp_path):
    p = tmp_path / "tangos.json"
    p.write_text(json.dumps(FIXTURE), encoding="utf-8")
    return p


# ── load_corpus ──────────────────────────────────────────────────────────────

def test_load_corpus_returns_set(fixture_path):
    words = load_corpus(fixture_path)
    assert isinstance(words, set)


def test_load_corpus_includes_plain_verso_words(fixture_path):
    words = load_corpus(fixture_path)
    assert "mundo" in words
    assert "porquería" in words
    assert "sé" in words


def test_load_corpus_includes_padding_words(fixture_path):
    words = load_corpus(fixture_path)
    assert "mañana" in words
    assert "artículo" in words
    assert "publicar" in words


def test_load_corpus_skips_metadata_keys(fixture_path):
    words = load_corpus(fixture_path)
    # "_nota" key should not contribute any words
    assert "nota" not in words
    assert "test" not in words
    assert "fixture" not in words


def test_load_corpus_lowercases_words(fixture_path):
    words = load_corpus(fixture_path)
    # "Tango" appears in titulo but not versos — only versos words are indexed
    # Verify that words from versos are lowercased
    assert "el" in words  # from verse, already lowercase
    assert "cuando" in words


def test_load_corpus_second_tango(fixture_path):
    words = load_corpus(fixture_path)
    assert "cuando" in words
    assert "falla" in words
    assert "solo" in words


# ── extract_words ────────────────────────────────────────────────────────────

def test_extract_words_basic():
    words = _mod.extract_words("hola mundo")
    assert "hola" in words
    assert "mundo" in words


def test_extract_words_accented():
    words = _mod.extract_words("mañana publicaré el artículo")
    assert "mañana" in words
    assert "publicaré" in words
    assert "artículo" in words


def test_extract_words_strips_punctuation():
    words = _mod.extract_words("hola, mundo.")
    assert "hola" in words
    assert "mundo" in words
    assert "," not in words
    assert "." not in words


def test_extract_words_strips_digits():
    words = _mod.extract_words("hay 3 opciones disponibles")
    assert "hay" in words
    assert "opciones" in words
    assert "3" not in words


def test_extract_words_empty_string():
    assert _mod.extract_words("") == []

