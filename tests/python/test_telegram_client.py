import pytest
import requests
from unittest.mock import patch, MagicMock
from telegram_client import enviar_mensaje
from tango_cifrado.telegram import TelegramApiError, TelegramNetworkError

# patch target is the module where requests.post is *called*, not where it's
# imported from the shim. After P4-1, that's tango_cifrado.telegram.
_PATCH = "tango_cifrado.telegram.requests.post"


def test_enviar_mensaje_exitoso():
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    with patch(_PATCH, return_value=mock_resp) as mock_post:
        result = enviar_mensaje("TOKEN", "123", "hola")
        assert result is True
        mock_post.assert_called_once()
        _, kwargs = mock_post.call_args
        assert kwargs["json"]["chat_id"] == "123"
        assert kwargs["json"]["text"] == "hola"


def test_enviar_mensaje_fallo_http():
    mock_resp = MagicMock()
    mock_resp.status_code = 400
    mock_resp.json.return_value = {"description": "Bad Request"}
    with patch(_PATCH, return_value=mock_resp):
        with pytest.raises(TelegramApiError) as exc_info:
            enviar_mensaje("TOKEN", "123", "hola")
        assert exc_info.value.status_code == 400
        assert "Bad Request" in str(exc_info.value)


def test_enviar_mensaje_sin_token_lanza_error():
    with pytest.raises(ValueError):
        enviar_mensaje("", "123", "hola")


def test_enviar_mensaje_sin_chat_id_lanza_error():
    with pytest.raises(ValueError):
        enviar_mensaje("TOKEN", "", "hola")


def test_url_contiene_token():
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    with patch(_PATCH, return_value=mock_resp) as mock_post:
        enviar_mensaje("MI_TOKEN", "123", "test")
        url = mock_post.call_args[0][0]
        assert "MI_TOKEN" in url


def test_timeout_lanza_network_error():
    with patch(_PATCH, side_effect=requests.exceptions.Timeout):
        with pytest.raises(TelegramNetworkError) as exc_info:
            enviar_mensaje("TOKEN", "123", "hola")
        assert "Tiempo de espera agotado" in str(exc_info.value)


def test_connection_error_lanza_network_error():
    with patch(_PATCH, side_effect=requests.exceptions.ConnectionError):
        with pytest.raises(TelegramNetworkError) as exc_info:
            enviar_mensaje("TOKEN", "123", "hola")
        assert "No se pudo conectar" in str(exc_info.value)


def test_request_exception_lanza_network_error():
    with patch(_PATCH, side_effect=requests.exceptions.RequestException("fail")):
        with pytest.raises(TelegramNetworkError) as exc_info:
            enviar_mensaje("TOKEN", "123", "hola")
        assert "Error inesperado" in str(exc_info.value)


def test_enviar_mensaje_fallo_http_sin_descripcion():
    mock_resp = MagicMock()
    mock_resp.status_code = 500
    mock_resp.json.side_effect = ValueError("not json")
    with patch(_PATCH, return_value=mock_resp):
        with pytest.raises(TelegramApiError) as exc_info:
            enviar_mensaje("TOKEN", "123", "hola")
        assert exc_info.value.status_code == 500
        assert exc_info.value.description == ""

