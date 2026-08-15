import {
  generateIdentity,
  exportPublicIdentity,
  exportPrivateIdentity,
  importPrivateIdentity,
  utf8,
  text,
  b64,
  unb64,
  sha256,
  hkdf,
  aesGcmEncrypt,
  aesGcmDecrypt,
} from './protocol/crypto/webcrypto.js';
import { sealMessage, openMessage } from './protocol/crypto/message.js';
import { prepareAttachment, encryptAttachment, decryptAttachment, deriveAttachmentKey } from './protocol/media/attachments.js';
import { CloudflareTransport } from './protocol/transport/cloudflare.js';
import { emptyDocument, validateDocument } from './protocol/messages/richtext.js';
import { loadTCMPConfig } from './storage.js';

function randomId(prefix='id') {
  return `${prefix}-${crypto.randomUUID()}`;
}

export async function createDevice({ baseUrl, userId, bootstrapToken, deviceId = randomId('device') }) {
  const identity = await generateIdentity();
  const publicIdentity = await exportPublicIdentity(identity);
  const response = await fetch(baseUrl.replace(/\/$/, '') + '/v1/devices/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bootstrap-token': bootstrapToken },
    body: JSON.stringify({ device_id: deviceId, user_id: userId, signing_public: publicIdentity.signing, receiving_public: publicIdentity.receiving }),
  });
  if (!response.ok) throw new Error(`Registro Cloudflare HTTP ${response.status}: ${await response.text()}`);
  const result = await response.json();
  const privateIdentity = await exportPrivateIdentity(identity);
  const config = { baseUrl: baseUrl.replace(/\/$/, ''), userId, deviceId, deviceToken: result.device_token, identity: privateIdentity };
  return config;
}

export async function loadIdentity(config) {
  if (!config?.identity) throw new Error('Este dispositivo todavía no tiene una identidad TCMP registrada.');
  return importPrivateIdentity(config.identity);
}

export function transportFromConfig(config) {
  if (!config?.baseUrl || !config?.deviceToken || !config?.deviceId) {
    throw new Error('Falta configurar el servidor Cloudflare, device ID o device token.');
  }
  return new CloudflareTransport({ baseUrl: config.baseUrl, deviceToken: config.deviceToken, deviceId: config.deviceId });
}

export async function getRoster(config) {
  return transportFromConfig(config).roster();
}

export async function sendText({ config, corpus, text: messageText, recipientDeviceId, richDocument = null }) {
  const identity = await loadIdentity(config);
  const roster = await getRoster(config);
  const target = (roster.devices || []).find(d => d.device_id === recipientDeviceId);
  if (!target) throw new Error('No se encontró el dispositivo destinatario.');
  const messageId = randomId('msg');
  const value = richDocument ? JSON.stringify(validateDocument(richDocument)) : messageText;
  const codePoints = Array.from(value);
  const chunkSize = 12000;
  const chunks = [];
  for (let i = 0; i < codePoints.length; i += chunkSize) chunks.push(codePoints.slice(i, i + chunkSize).join(''));
  if (!chunks.length) chunks.push('');
  const transport = transportFromConfig(config);
  for (let i = 0; i < chunks.length; i++) {
    const payload = utf8(chunks[i]);
    const envelope = await sealMessage({
      sender: identity,
      recipientReceivingJwk: target.receiving_public,
      senderDeviceId: config.deviceId,
      recipientDeviceId,
      payload,
      type: richDocument ? 'richtext' : 'text',
      corpus,
      messageId,
      chunkIndex: i,
      chunkCount: chunks.length,
    });
    await transport.sendEnvelope(recipientDeviceId, envelope);
  }
  return { messageId, chunkCount: chunks.length };
}

async function verifySha256(bytes, expectedB64) {
  const actual = b64(await sha256(bytes));
  if (actual !== expectedB64) throw new Error('La verificación SHA-256 del archivo falló.');
}

export async function pollInbox({ config, corpus }) {
  const identity = await loadIdentity(config);
  const transport = transportFromConfig(config);
  const roster = await transport.roster();
  const byDevice = new Map(roster.devices.map(d => [d.device_id, d]));
  const inbox = await transport.inbox();
  const groups = new Map();
  for (const item of inbox.messages || []) {
    const key = item.envelope.messageId || item.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const results = [];

  for (const items of groups.values()) {
    items.sort((a, b) => (a.envelope.chunkIndex || 0) - (b.envelope.chunkIndex || 0));
    const first = items[0].envelope;
    const expected = first.chunkCount || 1;
    if (items.length !== expected) continue;
    const sender = byDevice.get(first.senderDeviceId);
    if (!sender) throw new Error(`Remitente desconocido: ${first.senderDeviceId}`);
    const plaintextParts = [];
    for (const item of items) plaintextParts.push(await openMessage({ recipient: identity, senderSigningJwk: sender.signing_public, envelope: item.envelope, corpus }));
    const total = plaintextParts.reduce((n, p) => n + p.length, 0);
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const part of plaintextParts) { combined.set(part, offset); offset += part.length; }

    let value;
    if (first.type === 'text') value = { type: 'text', text: text(combined) };
    else if (first.type === 'richtext') value = { type: 'richtext', document: JSON.parse(text(combined)) };
    else if (first.type === 'attachment') {
      const manifest = JSON.parse(text(combined));
      const chunks = [];
      for (let i = 0; i < manifest.chunkCount; i++) {
        const raw = await transport.downloadAttachment(manifest.attachmentId, i);
        chunks.push(JSON.parse(new TextDecoder().decode(raw)));
      }
      const bytes = await decryptAttachment({ chunks, attachmentKey: unb64(manifest.attachmentKey), attachmentId: manifest.attachmentId, chunkCount: manifest.chunkCount });
      await verifySha256(bytes, manifest.sha256);
      value = { type: 'attachment', manifest, bytes };
    } else throw new Error(`Tipo TCMP desconocido: ${first.type}`);

    for (const item of items) await transport.deleteMessage(item.id);
    results.push({ id: first.messageId, envelope: first, value });
  }
  return results;
}

export function normalizeRichTextFromPlain(textValue) {
  return { ...emptyDocument(), blocks: [{ type: 'paragraph', spans: [{ text: String(textValue), style: {} }] }] };
}
