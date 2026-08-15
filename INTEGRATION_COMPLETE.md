# Tango Cifrado — integración TCMP en la PWA

Esta versión ya no deja TCMP como un paquete paralelo: `pwa/app.js` utiliza TCMP/Cloudflare como flujo principal para nuevos mensajes y mantiene el motor/transport de Telegram como compatibilidad legacy.

## Flujo nuevo

- texto plano: PWA -> TCMP -> Tango keyed codec -> Cloudflare D1 -> receptor
- texto enriquecido: documento JSON -> TCMP -> Cloudflare
- adjuntos: bytes -> AES-GCM por chunks -> Cloudflare R2; la envoltura con clave, nombre, MIME, tamaño y SHA-256 viaja cifrada en D1
- recepción: polling cada 5 s; los mensajes se agrupan por `messageId` y sólo se borran después de verificar y descifrar todo el grupo
- mensajes largos: se dividen en chunks lógicos de ~12.000 code points y se reconstruyen transparentemente

## Qué sigue siendo legacy

`pwa/cipherEngine.js`, `pwa/core/transport/*` y el transporte Telegram no se eliminan. La pestaña "Descifrar" sigue permitiendo descifrar códigos antiguos y Telegram queda disponible como compatibilidad para esos códigos.

## Registro de un dispositivo

1. Desplegar el Worker.
2. Configurar `ADMIN_BOOTSTRAP_TOKEN` como secret.
3. Abrir Ajustes de Cloudflare / TCMP en la PWA.
4. Introducir URL del Worker, usuario y token de bootstrap.
5. La PWA genera localmente las claves ECDSA/ECDH y registra sólo las claves públicas.
6. El token de dispositivo y la identidad privada quedan dentro de `payload.tcmp`; si el vault PIN está activo, quedan dentro de la bóveda sellada.

## Cloudflare

Desde `v2/`:

```bash
npx wrangler d1 create tango-cifrado
# copiar database_id a v2/wrangler.toml
npx wrangler r2 bucket create tango-cifrado-attachments
npx wrangler secret put ADMIN_BOOTSTRAP_TOKEN
# opcional: añadir ALLOWED_ORIGIN en vars o secret según el despliegue
npx wrangler d1 migrations apply tango-cifrado --remote
npx wrangler deploy
```

Antes de producción, sustituir el `ADMIN_BOOTSTRAP_TOKEN` compartido por un proceso administrativo más granular y restringir `ALLOWED_ORIGIN`.

## Pruebas

```bash
npm test
# includes pwa/core/tcmp/protocol.test.mjs (Tango codec roundtrip,
# message roundtrip, tampering detection, attachment exact byte roundtrip)
```

También verificar en dos dispositivos reales:

1. registrar A y B;
2. comprobar roster;
3. enviar texto corto;
4. enviar texto > 100 KB;
5. enviar texto enriquecido;
6. enviar PDF/DOCX/ZIP;
7. descargar el adjunto y comparar SHA-256;
8. cerrar/reabrir un dispositivo;
9. probar PIN vault;
10. modificar un ciphertext y comprobar rechazo.

## Advertencia criptográfica

La capa incluida es una base funcional de migración: ECDH P-256 efímero + ECDSA + HKDF + AES-256-GCM. No debe presentarse todavía como equivalente a un sistema de mensajería con Double Ratchet auditado. Antes de un despliegue para información de alto riesgo, sustituir `pwa/core/tcmp/protocol/crypto/message.js` por una implementación auditada manteniendo la misma interfaz de alto nivel.
