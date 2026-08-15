# Tango Cifrado v2 — paquete de migración

Este directorio añade la arquitectura TCMP al proyecto existente sin borrar el motor actual.

## Incluye

Los archivos de este directorio son el paquete de origen. Una vez completada la integración, los equivalentes viven en:

- `TCMP_V1.md`: especificación del protocolo — en la raíz del proyecto.
- `client/crypto` → `pwa/core/tcmp/protocol/crypto/`: identidad, ECDH efímero, HKDF, AES-GCM y firmas.
- `client/tango` → `pwa/core/tcmp/protocol/tango/`: codec Tango con permutación derivada de la clave de sesión.
- `client/messages/richtext.js` → `pwa/core/tcmp/protocol/messages/richtext.js`: modelo de texto enriquecido.
- `client/media/attachments.js` → `pwa/core/tcmp/protocol/media/attachments.js`: cifrado por chunks y verificación SHA-256.
- `client/transport/cloudflare.js` → `pwa/core/tcmp/protocol/transport/cloudflare.js`: transporte HTTP al Worker.
- `worker/index.js`: Worker Cloudflare para buzón D1 y blobs R2 — se despliega desde `v2/`.
- `migrations/0001_init.sql`: esquema D1 — se aplica desde `v2/`.
- `wrangler.toml`: configuración inicial — se edita en `v2/`.

## Importante antes de producción

La implementación de sesión incluida es una base funcional para la migración y usa ECDH efímero + firma + AEAD. **No debe presentarse todavía como sustituto de un protocolo Double Ratchet auditado**. La interfaz está separada para permitir sustituir esta capa por una implementación auditada antes del despliegue con información de alto riesgo.

## Instalación Cloudflare

1. Crear D1:
   `npx wrangler d1 create tango-cifrado`
2. Poner el `database_id` devuelto en `wrangler.toml`.
3. Crear R2:
   `npx wrangler r2 bucket create tango-cifrado-attachments`
4. Crear secret:
   `npx wrangler secret put ADMIN_BOOTSTRAP_TOKEN`
5. Aplicar migración:
   `npx wrangler d1 migrations apply tango-cifrado --remote`
6. Publicar:
   `npx wrangler deploy`

## Corpus

El codec exige al menos 256 palabras únicas. El proyecto actual ya tiene 314 palabras únicas (8 tangos), por lo que satisface ese mínimo; la expansión futura del corpus sigue siendo conveniente por variedad y cobertura.

## Migración

No eliminar Telegram inmediatamente. Primero ejecutar una rama de prueba:

`PWA -> TCMP -> Cloudflare -> PWA`

Una vez comprobados los vectores de interoperabilidad, retirar Telegram del flujo de producción.
