import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { allowLocalCors } from '../src/api/server.js';

test('allows localhost GUI origins', async () => {
  const app = Fastify();
  allowLocalCors(app);
  app.get('/api/status', async () => ({ ok: true }));

  const res = await app.inject({
    method: 'GET',
    url: '/api/status',
    headers: { origin: 'http://localhost:1420' },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:1420');
  assert.match(res.headers['access-control-allow-methods'], /POST/);
  await app.close();
});

test('allows Tauri production GUI origin', async () => {
  const app = Fastify();
  allowLocalCors(app);
  app.get('/api/status', async () => ({ ok: true }));

  const res = await app.inject({
    method: 'GET',
    url: '/api/status',
    headers: { origin: 'http://tauri.localhost' },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['access-control-allow-origin'], 'http://tauri.localhost');
  await app.close();
});

test('rejects non-local origins', async () => {
  const app = Fastify();
  allowLocalCors(app);
  app.get('/api/status', async () => ({ ok: true }));

  const res = await app.inject({
    method: 'GET',
    url: '/api/status',
    headers: { origin: 'https://evil.example' },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['access-control-allow-origin'], undefined);
  await app.close();
});
