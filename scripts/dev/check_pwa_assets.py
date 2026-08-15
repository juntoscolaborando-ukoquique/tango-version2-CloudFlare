#!/usr/bin/env python3
"""
check_pwa_assets.py

Sanity check for the pwa/ directory, two directions:

  1. FORWARD (reference → exists on disk):
     Every local asset referenced by manifest.json icons, index.html
     (@font-face / <link> / <img src=…>), and service-worker.js
     (SHELL_FILES) must actually exist on disk.
     This catches "deleted a font file but forgot to update the
     manifest/service worker/index reference.

  2. REVERSE (exists on disk → referenced somewhere):
     Every binary/static asset in pwa/fonts/ and pwa/icons/ must be referenced
     by at least one of: manifest.json icons, index.html, or
     service-worker.js SHELL_FILES.
     This catches dead-weight: .ttf/.png files still sitting in git (and
     getting published to GitHub Pages) even though no CSS or SW precache
     actually need them any more.

OFL license .txt files in fonts/ and encrypted-bundle.json are
deliberately exempted from the reverse check -- a license text is never
"referenced" by the HTML, and the bundle JSON is loaded by fetch() at
runtime, not by a static @font-face/<link>/SHELL_FILES.

Run this locally before any PR that touches pwa/. CI runs it automatically
via .github/workflows/check-pwa-assets.yml.

Usage:
    python3 scripts/check_pwa_assets.py
"""
import json
import re
import sys
from pathlib import Path

PWA_DIR = Path(__file__).resolve().parent.parent.parent / "pwa"

KNOWN_LICENSE_SUFFIXES = ("-OFL.txt", "-OFL.md", "-LICENSE.txt", "-LICENSE.md", "OFL.txt", "LICENSE.txt")


def _is_license_text(rel_path: str) -> bool:
    name = Path(rel_path).name
    low = name.lower()
    return (
        (low.endswith(".txt") and ("ofl" in low or "license" in low))
        or (low.endswith(".md") and ("ofl" in low or "license" in low))
    )


def check_manifest():
    missing = []
    referenced = set()
    manifest_path = PWA_DIR / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for icon in manifest.get("icons", []):
        src = icon["src"]
        # Absolute URLs (http/https) point to the deployed site — skip local
        # file check. They're correct by definition for TWA manifests and can't
        # be verified without a network request.
        if src.startswith("http://") or src.startswith("https://"):
            continue
        referenced.add(src.replace("./", "", 1).lstrip("/"))
        path = PWA_DIR / src
        if not path.is_file():
            missing.append(f"manifest.json icon: {src}")
    return missing, referenced


def check_index_html():
    missing = []
    referenced = set()
    html = (PWA_DIR / "index.html").read_text(encoding="utf-8")

    for match in re.finditer(r'url\("\.\/([^"]+)"\)', html):
        rel = match.group(1)
        referenced.add(rel)
        if not (PWA_DIR / rel).is_file():
            missing.append(f"index.html @font-face: ./{rel}")

    for attr in ("href", "src"):
        for match in re.finditer(rf'<[^>]+\b{attr}="\.\/([^"]+)"', html):
            rel = match.group(1)
            if rel.endswith(".json"):
                continue
            referenced.add(rel)
            if not (PWA_DIR / rel).is_file():
                missing.append(f"index.html <{attr}>: ./{rel}")

    return missing, referenced


def check_service_worker():
    missing = []
    referenced = set()
    sw = (PWA_DIR / "service-worker.js").read_text(encoding="utf-8")
    match = re.search(r"const SHELL_FILES = \[(.*?)\];", sw, re.DOTALL)
    if not match:
        return ["service-worker.js: could not find SHELL_FILES array"], set()
    entries = re.findall(r'"\./([^"]*)"', match.group(1))
    for rel in entries:
        rel_norm = "index.html" if rel == "" else rel
        referenced.add(rel_norm)
        target = PWA_DIR / rel_norm
        if not target.is_file():
            missing.append(f"service-worker.js SHELL_FILES: ./{rel_norm if rel else 'index.html (empty \"\" entry)'}")
    return missing, referenced


def check_orphan_assets(all_referenced: set[str]) -> list[str]:
    """Find font/icon files under pwa/ that aren't referenced anywhere.

    Skips:
      - OFL / LICENSE text files in fonts/
      - encrypted-bundle.json (loaded by fetch(), not statically referenced)
      - manifest.json itself, index.html itself, JS files, .DS_Store
    """
    orphans = []
    for subdir_name in ("fonts", "icons"):
        subdir = PWA_DIR / subdir_name
        if not subdir.is_dir():
            continue
        for path in sorted(subdir.rglob("*")):
            if not path.is_file():
                continue
            rel = str(path.relative_to(PWA_DIR)).replace("\\", "/")
            if rel in all_referenced:
                continue
            # License text files are never "referenced" in the sources; that's fine.
            if _is_license_text(rel):
                continue
            orphans.append(f"{subdir_name}/: {rel}")
    return orphans


def main():
    manifest_missing, manifest_refs = check_manifest()
    index_missing, index_refs = check_index_html()
    sw_missing, sw_refs = check_service_worker()

    all_missing = manifest_missing + index_missing + sw_missing
    all_referenced = manifest_refs | index_refs | sw_refs

    orphan_msgs = []
    if not all_missing:
        # Only run the orphan check if the forward pass is clean;
        # if refs are already broken, orphans are the least important problem.
        orphan_msgs = check_orphan_assets(all_referenced)

    if all_missing or orphan_msgs:
        print("FALLÓ la validación de assets de pwa/:", file=sys.stderr)
        for item in all_missing:
            print(f"  [FALTANTE] {item}", file=sys.stderr)
        for item in orphan_msgs:
            print(f"  [HÚERFANO, NO REFERENCIADO] {item}", file=sys.stderr)
        sys.exit(1)

    print("OK -- todos los assets referenciados existen, y no hay fonts/icons huérfanos en pwa/.")


if __name__ == "__main__":
    main()

