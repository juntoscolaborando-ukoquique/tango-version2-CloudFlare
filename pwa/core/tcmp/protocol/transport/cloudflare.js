export class CloudflareTransport {
  constructor({ baseUrl, deviceToken, deviceId }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.deviceToken = deviceToken;
    this.deviceId = deviceId;
  }

  async request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('authorization', `Bearer ${this.deviceToken}`);
    if (options.body && !(options.body instanceof ReadableStream) && typeof options.body !== 'string' && !(options.body instanceof Uint8Array) && !(options.body instanceof ArrayBuffer)) {
      headers.set('content-type', 'application/json');
    }
    const response = await fetch(this.baseUrl + path, { ...options, headers });
    if (!response.ok) throw new Error(`Cloudflare HTTP ${response.status}: ${await response.text()}`);
    if (response.status === 204) return null;
    const type = response.headers.get('content-type') || '';
    return type.includes('application/json') ? response.json() : response.arrayBuffer().then(b => new Uint8Array(b));
  }

  health() { return this.request('/v1/health'); }
  roster() { return this.request('/v1/roster'); }
  sendEnvelope(recipientDeviceId, envelope) {
    return this.request('/v1/messages', { method: 'POST', body: JSON.stringify({ recipient_device_id: recipientDeviceId, envelope }) });
  }
  inbox() { return this.request('/v1/inbox/' + encodeURIComponent(this.deviceId)); }
  deleteMessage(id) { return this.request('/v1/messages/' + encodeURIComponent(id), { method: 'DELETE' }); }

  async uploadAttachment(attachmentId, index, bytes) {
    const headers = new Headers({ authorization: `Bearer ${this.deviceToken}`, 'content-type': 'application/octet-stream' });
    const response = await fetch(`${this.baseUrl}/v1/attachments/${encodeURIComponent(attachmentId)}/${index}`, {
      method: 'PUT', headers, body: bytes
    });
    if (!response.ok) throw new Error(`Upload HTTP ${response.status}: ${await response.text()}`);
    return response.json();
  }

  async downloadAttachment(attachmentId, index) {
    const headers = new Headers({ authorization: `Bearer ${this.deviceToken}` });
    const response = await fetch(`${this.baseUrl}/v1/attachments/${encodeURIComponent(attachmentId)}/${index}`, { headers });
    if (!response.ok) throw new Error(`Descarga HTTP ${response.status}: ${await response.text()}`);
    return new Uint8Array(await response.arrayBuffer());
  }
}
