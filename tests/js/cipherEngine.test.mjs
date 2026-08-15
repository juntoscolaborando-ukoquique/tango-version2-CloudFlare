// Run with: node --test tests/js/cipherEngine.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { cifrarMensaje, descifrarMensaje } from '../../pwa/cipherEngine.js';

const BASE = {
  3: {
    titulo: 'Cambalache',
    versos: [
      ['Que', 'el', 'mundo', 'fue', 'y', 'será', 'una', 'porquería', 'ya', 'lo', 'sé'],
      ['mañana', 'subir', 'este', 'artículo', 'que', 'te', 'di', 'ayer'],
    ],
  },
};
const SALT = 47;

// --- round-trip ---

test('round-trip: minúsculas', async () => {
  const msg = 'el mundo';
  assert.equal(await descifrarMensaje(await cifrarMensaje('3', msg, BASE, SALT), BASE, SALT), msg);
});

test('round-trip: capitalización mixta y puntuación', async () => {
  const msg = 'Mañana subir este Artículo, que te di ayer.';
  assert.equal(await descifrarMensaje(await cifrarMensaje('3', msg, BASE, SALT), BASE, SALT), msg);
});

test('round-trip: palabra fuera del corpus (fallback)', async () => {
  const msg = 'Magnifico';
  assert.equal(await descifrarMensaje(await cifrarMensaje('3', msg, BASE, SALT), BASE, SALT), msg);
});

test('fallback: el keystream cambia con el contexto del mensaje', async () => {
  const a = await cifrarMensaje('3', 'hola magnifico', BASE, SALT);
  const b = await cifrarMensaje('3', 'mundo magnifico', BASE, SALT);
  assert.notEqual(a.split('-')[3], b.split('-')[3]);
});

test('round-trip: dígitos consecutivos agrupados', async () => {
  const msg = 'reunion a las 15:30 en la calle 8';
  assert.equal(await descifrarMensaje(await cifrarMensaje('3', msg, BASE, SALT), BASE, SALT), msg);
});

test('round-trip: signos especiales (¿?)', async () => {
  const msg = '¿Cómo estás?';
  assert.equal(await descifrarMensaje(await cifrarMensaje('3', msg, BASE, SALT), BASE, SALT), msg);
});

test('cifrar: ID de tango inválido lanza error', async () => {
  await assert.rejects(() => cifrarMensaje('99', 'hola', BASE, SALT), /no válido/);
});

test('cifrar: clave de metadata rechazada', async () => {
  const baseConMetadata = { ...BASE, _nota: 'esto no es un tango' };
  await assert.rejects(() => cifrarMensaje('_nota', 'hola', baseConMetadata, SALT), /no válido/);
});

// --- descifrar: entradas malformadas ---

test('descifrar: mensaje vacío lanza error', async () => {
  await assert.rejects(() => descifrarMensaje('', BASE, SALT), /inválido/);
});

test('descifrar: sin guión lanza error', async () => {
  await assert.rejects(() => descifrarMensaje('50V01P01', BASE, SALT), /inválido/);
});

test('descifrar: clave no numérica lanza error', async () => {
  await assert.rejects(() => descifrarMensaje('abc-V01P01', BASE, SALT), /número/);
});

test('descifrar: token de coordenada malformado lanza error', async () => {
  await assert.rejects(() => descifrarMensaje('50-INVALID', BASE, SALT), /malformado/);
});

test('descifrar: hex de fallback malformado lanza error', async () => {
  await assert.rejects(() => descifrarMensaje('50-#xyz', BASE, SALT), /malformado/);
});

test('descifrar: índice de verso fuera de rango lanza error', async () => {
  const coded = await cifrarMensaje('3', 'el', BASE, SALT);
  const corrupted = coded.replace('V01P02', 'V99P01');
  await assert.rejects(() => descifrarMensaje(corrupted, BASE, SALT), /verso/);
});

test('descifrar: índice de palabra fuera de rango lanza error', async () => {
  const coded = await cifrarMensaje('3', 'el', BASE, SALT);
  const corrupted = coded.replace('V01P02', 'V01P99');
  await assert.rejects(() => descifrarMensaje(corrupted, BASE, SALT), /palabra/);
});

test('descifrar: clave enmascarada inválida lanza error', async () => {
  await assert.rejects(() => descifrarMensaje('999-V01P01', BASE, SALT), /inválida/);
});

// ---------- shared cross-engine vectors (P3-6) ----------

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VECTORS = JSON.parse(readFileSync(path.join(__dirname, '..', 'vectors.json'), 'utf-8'));

for (const c of VECTORS.cases) {
  test(`shared vector: ${c.name}`, async () => {
    const { corpus, salt } = VECTORS;

    if (c.error) {
      await assert.rejects(
        () => cifrarMensaje(c.id_tango, c.mensaje, corpus, salt),
        undefined,
        `Expected cifrarMensaje to reject for vector '${c.name}'`
      );
      return;
    }

    const cifrado = await cifrarMensaje(c.id_tango, c.mensaje, corpus, salt);

    if (c.roundtrip_only) {
      const resultado = await descifrarMensaje(cifrado, corpus, salt);
      assert.equal(
        resultado,
        c.mensaje,
        `Round-trip failed for vector '${c.name}': ` +
          `encrypt→'${cifrado}', decrypt→'${resultado}', expected '${c.mensaje}'`
      );
      return;
    }

    assert.equal(
      cifrado,
      c.ciphertext,
      `JS cifrarMensaje diverged from tests/vectors.json for '${c.name}': ` +
        `got '${cifrado}', expected '${c.ciphertext}'. ` +
        `If the wire format changed intentionally, regenerate vectors.json and ` +
        `update private_core/cipher_engine.py in the same commit.`
    );
  });
}

