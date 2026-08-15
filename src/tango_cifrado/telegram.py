"""
telegram.py — Telegram Bot API delivery module.

Moved from the project root's telegram_client.py into this package.
The root-level telegram_client.py is kept as a thin re-export shim
so existing callers (tests, scripts) don't break during the transition.
"""
import requests

# Telegram's sendMessage caps text at 4096 UTF-8 characters. Sending anything
# longer gets rejected with HTTP 400, with no indication in the old code of
# *why* -- checking this upfront turns a confusing failed-silently send into
# a clear, actionable error before any network call happens.
TELEGRAM_MAX_LEN = 4096


class TelegramError(Exception):
    """Base exception for Telegram delivery failures."""
    pass


class TelegramApiError(TelegramError):
    """Telegram API returned an HTTP error response."""
    def __init__(self, status_code, description=""):
        self.status_code = status_code
        self.description = description
        if description:
            super().__init__(f"Telegram API error {status_code}: {description}")
        else:
            super().__init__(f"Telegram API error: HTTP {status_code}")


class TelegramNetworkError(TelegramError):
    """Network connectivity issue when contacting Telegram."""
    pass


def enviar_mensaje(bot_token, chat_id, texto):
    """Envía un mensaje de texto al chat indicado via Telegram Bot API.

    Raises ValueError si faltan credenciales o el texto excede el límite de Telegram.
    Raises TelegramApiError si Telegram devuelve un error HTTP.
    Raises TelegramNetworkError si hay problemas de conectividad.
    Returns True si el envío fue exitoso.
    """
    if not bot_token or not chat_id:
        raise ValueError("bot_token y chat_id son obligatorios")

    if len(texto) > TELEGRAM_MAX_LEN:
        raise ValueError(
            f"El mensaje cifrado mide {len(texto)} caracteres, "
            f"Telegram acepta un máximo de {TELEGRAM_MAX_LEN}. "
            "Probá con un mensaje más corto o un tango con más palabras "
            "en el corpus (menos texto cae en el fallback, que es lo que "
            "más infla la longitud del cifrado)."
        )

    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = {"chat_id": chat_id, "text": texto}
    try:
        resp = requests.post(url, json=payload, timeout=10)
        if resp.status_code == 200:
            return True
        
        # Telegram's error responses are JSON with a human-readable
        # "description" field (e.g. "Bad Request: message is too long") --
        # surface that instead of just the bare status code.
        try:
            detalle = resp.json().get("description", "")
        except ValueError:
            detalle = ""
        
        raise TelegramApiError(resp.status_code, detalle)
        
    except requests.exceptions.Timeout:
        raise TelegramNetworkError("Tiempo de espera agotado al contactar Telegram")
    except requests.exceptions.ConnectionError:
        raise TelegramNetworkError("No se pudo conectar a Telegram. Verificar conexión a internet")
    except requests.exceptions.RequestException as e:
        raise TelegramNetworkError(f"Error inesperado al enviar mensaje: {e}")

