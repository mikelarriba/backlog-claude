import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startTestApp } from '../helpers/testApp.js';

function rawRequest(port, { method = 'GET', path = '/api/health', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('host / origin guard', () => {
  let ctx;
  let port;
  before(async () => {
    ctx = await startTestApp();
    port = Number(new URL(ctx.baseUrl).port);
  });
  after(async () => {
    await ctx.stop();
  });

  it('allows localhost Host header', async () => {
    assert.equal(await rawRequest(port, { headers: { Host: `localhost:${port}` } }), 200);
  });

  it('rejects a foreign Host header (DNS rebinding)', async () => {
    assert.equal(await rawRequest(port, { headers: { Host: 'evil.example.com' } }), 403);
  });

  it('rejects a cross-origin mutating request', async () => {
    const status = await rawRequest(port, {
      method: 'POST',
      path: '/api/does-not-matter',
      headers: {
        Host: `localhost:${port}`,
        Origin: 'http://evil.example.com',
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    assert.equal(status, 403);
  });

  it('allows a same-origin mutating request and requests without Origin', async () => {
    const same = await rawRequest(port, {
      method: 'POST',
      path: '/api/does-not-matter',
      headers: {
        Host: `localhost:${port}`,
        Origin: `http://localhost:${port}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    assert.notEqual(same, 403);
    const none = await rawRequest(port, {
      method: 'POST',
      path: '/api/does-not-matter',
      headers: { Host: `localhost:${port}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.notEqual(none, 403);
  });
});
