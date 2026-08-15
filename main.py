"""
main.py — thin entry point shim.

All logic lives in src/tango_cifrado/cli.py. This file exists so the
project can be launched with `python3 main.py` from the project root
without needing to install the package or set PYTHONPATH manually.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from tango_cifrado.cli import main  # noqa: E402

if __name__ == "__main__":
    main()

