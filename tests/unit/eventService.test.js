// ── Unit tests: src/services/eventService.js ──────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createEventService } from '../../src/services/eventService.js';
import { EventEmitter } from 'node:events';

function mockClient() {
  const chunks = [];
  const req = new EventEmitter();
  const res = {
    setHeader() {},
    flushHeaders() {},
    write(data) { chunks.push(data); },
    chunks,
  };
  return { req, res, chunks };
}

describe('createEventService', () => {
  test('handleEvents sends connected event and stores client', () => {
    const { handleEvents } = createEventService();
    const { req, res, chunks } = mockClient();
    handleEvents(req, res);
    assert.equal(chunks.length, 1);
    assert.match(chunks[0], /connected/);
  });

  test('broadcast sends data to all connected clients', () => {
    const { handleEvents, broadcast } = createEventService();
    const c1 = mockClient();
    const c2 = mockClient();
    handleEvents(c1.req, c1.res);
    handleEvents(c2.req, c2.res);
    broadcast({ type: 'test_event', value: 42 });
    // Each client got the connected event + the broadcast
    assert.equal(c1.chunks.length, 2);
    assert.equal(c2.chunks.length, 2);
    assert.match(c1.chunks[1], /test_event/);
    assert.match(c2.chunks[1], /test_event/);
  });

  test('client is removed from set on connection close', () => {
    const { handleEvents, broadcast } = createEventService();
    const { req, res, chunks } = mockClient();
    handleEvents(req, res);
    // Simulate client disconnect
    req.emit('close');
    broadcast({ type: 'after_close' });
    // Should only have the initial connected event, not the broadcast
    assert.equal(chunks.length, 1);
  });

  test('broadcast formats data as SSE', () => {
    const { handleEvents, broadcast } = createEventService();
    const { req, res, chunks } = mockClient();
    handleEvents(req, res);
    broadcast({ type: 'hello' });
    assert.match(chunks[1], /^data: /);
    assert.match(chunks[1], /\n\n$/);
    const json = JSON.parse(chunks[1].replace('data: ', '').trim());
    assert.equal(json.type, 'hello');
  });

  test('broadcast with no clients does not throw', () => {
    const { broadcast } = createEventService();
    assert.doesNotThrow(() => broadcast({ type: 'orphan' }));
  });

  test('broadcast survives a client that throws on write', () => {
    const { handleEvents, broadcast } = createEventService();
    const good = mockClient();
    const bad  = mockClient();
    handleEvents(good.req, good.res);
    handleEvents(bad.req, bad.res);
    // Make the bad client throw on subsequent writes (after connected event)
    bad.res.write = () => { throw new Error('broken pipe'); };
    // Should not throw — bad client is silently removed
    assert.doesNotThrow(() => broadcast({ type: 'test' }));
    assert.equal(good.chunks.length, 2); // connected + broadcast
  });
});
