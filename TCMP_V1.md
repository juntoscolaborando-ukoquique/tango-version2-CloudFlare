# TCMP v1 — Tango Cifrado Message Protocol

## Objetivo

TCMP transporta mensajes de texto, texto enriquecido y adjuntos binarios de extremo a extremo. El servidor Cloudflare funciona como buzón/almacén y nunca recibe el contenido en claro.

## Capas

1. **Identity**: cada dispositivo tiene una clave ECDSA P-256 para firmar y una clave ECDH P-256 para recibir.
2. **Message crypto**: cada mensaje genera una clave efímera ECDH; HKDF deriva una clave AES-256-GCM.
3. **Tango Crypto Codec**: el ciphertext binario se representa mediante palabras del corpus Tango usando una permutación determinista derivada de una clave `K_tango`. Esto no sustituye al AEAD: añade una capa reversible, dependiente de la sesión y basada realmente en el corpus.
4. **Envelope**: contiene versión, tipo, nonce, clave pública efímera, ciphertext y firma.
5. **Attachments**: archivos se conservan como bytes. Se cifran por chunks y se almacenan en R2. El SHA-256 del archivo original queda autenticado.

## Tipos

- `text`: texto plano UTF-8.
- `richtext`: documento estructurado JSON; el formato visual se conserva al reconstruirlo.
- `attachment`: referencia a uno o más blobs cifrados.

## Seguridad

El diseño inicial usa Web Crypto y P-256 para que el cliente pueda funcionar sin depender de Telegram. La identidad del remitente debe validarse mediante un directorio confiable o un código de verificación fuera de banda.

**Importante:** esta primera implementación no pretende sustituir a un protocolo Double Ratchet auditado. La interfaz de `SessionCrypto` está separada para que pueda sustituirse por una implementación auditada antes de declarar el sistema listo para despliegue de alto riesgo.

**Autorización en el Worker:** el acceso a adjuntos está vinculado al dispositivo propietario via la tabla `attachment_owners` (D1). PUT: solo el uploader original puede escribir chunks para un `attachmentId` dado. GET: el uploader o cualquier dispositivo al que el uploader le haya enviado un mensaje que referencia ese `attachmentId`. Limitación conocida: el chequeo de recipiente usa `LIKE` sobre el JSON del envelope — suficiente a esta escala, pero si se agrega una columna `attachment_id` en `messages` conviene reemplazarlo por un join indexado.

## Propiedades de archivos

Para cada archivo:

- se calcula SHA-256 antes del cifrado;
- se cifra por chunks;
- cada chunk está autenticado con `attachmentId`, `chunkIndex` y `chunkCount` como AAD;
- se almacena ciphertext en R2;
- el receptor descifra y verifica el hash final;
- el nombre y MIME originales son metadatos cifrados.

El archivo recuperado debe producir exactamente el mismo SHA-256 que el original.
