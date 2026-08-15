"""
cli.py — interactive CLI entry point for the tango cipher.

Equivalent to the former root-level main.py, now living inside the package
so all private_core access goes through corpus.py.
"""
import os

from dotenv import load_dotenv

from tango_cifrado.corpus import cargar_tangos, cifrar_mensaje, descifrar_mensaje
from tango_cifrado.telegram import enviar_mensaje, TelegramError

load_dotenv()

_PROJECT_ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
TANGOS_PATH = os.path.join(_PROJECT_ROOT, "private_core", "tangos.json")

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID")


def main():
    base = cargar_tangos(TANGOS_PATH)
    print("=== SISTEMA DE CIFRADO POR TANGOS (TELEGRAM) ===")
    id_tango = input("Ingrese la clave de Tango (ej: 3): ")
    mensaje = input("Ingrese el mensaje a enviar: ")

    try:
        # salt=None -> cifrar_mensaje resuelves CIFRADO_SALT from env,
        # or DEFAULT_SALT if not set. See cipher_engine._resolve_salt.
        codigo_cifrado = cifrar_mensaje(id_tango, mensaje, base, salt=None)
    except ValueError as e:
        print(f"Error al cifrar: {e}")
        exit(1)

    print(f"\nCódigo Cifrado Generado: {codigo_cifrado}")

    try:
        enviar_mensaje(BOT_TOKEN, CHAT_ID, codigo_cifrado)
        print("Mensaje enviado con éxito a Telegram.")
    except ValueError as e:
        print(f"Error de configuración: {e}")
    except TelegramError as e:
        print(f"Error al enviar mensaje a Telegram: {e}")

    try:
        print("\nPrueba de descifrado en recepción:")
        print(f"Texto Descifrado: {descifrar_mensaje(codigo_cifrado, base)}")
    except ValueError as e:
        print(f"Error al descifrar: {e}")


if __name__ == "__main__":
    main()

