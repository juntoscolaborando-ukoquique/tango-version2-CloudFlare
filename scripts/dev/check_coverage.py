#!/usr/bin/env python3
"""
check_coverage.py — verifica la cobertura de codificación de un texto de prueba
contra el corpus de tangos (Fase 2 del ROADMAP).

Para cada palabra única del texto de prueba informa si está cubierta por algún
verso del corpus (se codificará como coordenada V/P) o si caerá al fallback XOR
hex (#hex). Muestra el porcentaje global de cobertura y lista las palabras sin
cobertura para guiar la expansión del corpus.

Uso:
    python3 scripts/dev/check_coverage.py "texto de prueba"
    python3 scripts/dev/check_coverage.py --file ruta/al/texto.txt
    python3 scripts/dev/check_coverage.py  # usa el texto de prueba interno

Requiere private_core/ poblado:
    ./scripts/dev/setup_private_core.sh

CI: correrlo antes de agregar tangos nuevos para medir el impacto real en
cobertura. Ver ROADMAP.md Fase 2.
"""

import argparse
import json
import re
import sys
from pathlib import Path

# Ensure project root is importable regardless of cwd
PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

TANGOS_PATH = PROJECT_ROOT / "private_core" / "tangos.json"

# Default sample text — includes accented chars, punctuation, digits,
# common Spanish words and some technical vocab likely to fall back.
DEFAULT_TEXT = (
    "Mañana voy a subir el artículo que te di ayer. "
    "Publicá el nuevo documento del cliente hoy. "
    "Escribí al contacto por el nuevo canal. "
    "Los datos del servidor para continuar están listos. "
    "Guardamos la información, secretos y claves aquí. "
    "El mundo fue y será una porquería, ya lo sé."
)


def load_corpus(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    # Build a set of all lowercase words in the corpus
    words = set()
    for key, tango in data.items():
        if key.startswith("_"):
            continue
        for verso in tango.get("versos", []):
            if isinstance(verso, dict) and verso.get("padding"):
                items = verso.get("palabras", [])
            elif isinstance(verso, list):
                items = verso
            else:
                continue
            for word in items:
                words.add(word.lower())
    return words


def extract_words(text: str) -> list[str]:
    """Extract Unicode word tokens (letters only), lowercased.
    Uses [^\\W\\d_]+ which matches Unicode letters but not digits or underscores,
    matching the same token set as cipherEngine.js's /\\p{L}+/gu.
    """
    return re.findall(r"[^\W\d_]+", text.lower(), re.UNICODE)


def main():
    parser = argparse.ArgumentParser(description="Verifica cobertura del corpus contra un texto de prueba.")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("text", nargs="?", help="Texto de prueba inline")
    group.add_argument("--file", "-f", metavar="PATH", help="Archivo de texto de prueba")
    args = parser.parse_args()

    if not TANGOS_PATH.exists():
        print(f"❌ No se encontró {TANGOS_PATH}. Corré ./scripts/dev/setup_private_core.sh primero.", file=sys.stderr)
        sys.exit(1)

    corpus_words = load_corpus(TANGOS_PATH)

    if args.file:
        text = Path(args.file).read_text(encoding="utf-8")
    elif args.text:
        text = args.text
    else:
        text = DEFAULT_TEXT
        print("(Usando texto de prueba interno. Pasá un argumento o --file para usar otro.)\n")

    all_tokens = re.findall(r"[^\W\d_]+", text.lower(), re.UNICODE)
    unique_words = sorted(set(all_tokens))

    covered = [w for w in unique_words if w in corpus_words]
    missing = [w for w in unique_words if w not in corpus_words]

    total = len(unique_words)
    pct = 100 * len(covered) / total if total else 0

    print(f"Corpus: {TANGOS_PATH.parent.name}/tangos.json  ({len(corpus_words)} palabras únicas)")
    print(f"Texto : {total} palabras únicas\n")
    print(f"✅ Cobertura: {len(covered)}/{total} ({pct:.1f}%)")

    if missing:
        print(f"\n⚠️  Sin cobertura ({len(missing)} palabras → usarán fallback XOR hex):")
        for w in missing:
            print(f"   {w}")
    else:
        print("\n✅ Todas las palabras están cubiertas por el corpus.")

    # Exit 1 if coverage is below 80% so CI can gate on it
    if pct < 80:
        sys.exit(1)


if __name__ == "__main__":
    main()

