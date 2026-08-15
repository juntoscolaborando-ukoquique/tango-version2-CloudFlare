"""
telegram_client.py — backward-compatibility shim.

The implementation moved to src/tango_cifrado/telegram.py (P4-1).
This file re-exports everything so existing callers
(tests/python/test_telegram_client.py, any external scripts) keep working
without changes.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from tango_cifrado.telegram import (  # noqa: F401, E402
    enviar_mensaje,
    TelegramError,
    TelegramApiError, 
    TelegramNetworkError,
    TELEGRAM_MAX_LEN,
)
import requests  # noqa: F401 — kept here so patch("telegram_client.requests.post") still works in tests

