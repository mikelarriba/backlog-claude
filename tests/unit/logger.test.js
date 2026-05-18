// ── Unit tests: src/utils/logger.js ───────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../../src/utils/logger.js';

describe('createLogger — level filtering', () => {
  const origLevel = process.env.LOG_LEVEL;
  const calls = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, debug: console.debug };

  before(() => {
    // Intercept all console methods
    console.log   = (...a) => calls.push({ method: 'log',   args: a });
    console.warn  = (...a) => calls.push({ method: 'warn',  args: a });
    console.error = (...a) => calls.push({ method: 'error', args: a });
    console.debug = (...a) => calls.push({ method: 'debug', args: a });
  });

  after(() => {
    Object.assign(console, orig);
    if (origLevel !== undefined) process.env.LOG_LEVEL = origLevel;
    else delete process.env.LOG_LEVEL;
  });

  test('INFO level suppresses DEBUG calls', () => {
    process.env.LOG_LEVEL = 'info';
    calls.length = 0;
    const { logDebug, logInfo } = createLogger('[test]');
    logDebug('scope', 'debug msg');
    logInfo('scope', 'info msg');
    assert.equal(calls.filter(c => c.method === 'debug').length, 0, 'debug should be suppressed');
    assert.equal(calls.filter(c => c.method === 'log').length, 1, 'info should pass through');
  });

  test('ERROR level suppresses INFO and WARN', () => {
    process.env.LOG_LEVEL = 'error';
    calls.length = 0;
    const { logInfo, logWarn, logError } = createLogger('[test]');
    logInfo('scope', 'info msg');
    logWarn('scope', 'warn msg');
    logError('scope', 'error msg');
    assert.equal(calls.filter(c => c.method === 'log').length, 0, 'info suppressed at ERROR level');
    assert.equal(calls.filter(c => c.method === 'warn').length, 0, 'warn suppressed at ERROR level');
    assert.equal(calls.filter(c => c.method === 'error').length, 1, 'error passes through');
  });

  test('DEBUG level allows all calls through', () => {
    process.env.LOG_LEVEL = 'debug';
    calls.length = 0;
    const { logDebug, logInfo, logWarn, logError } = createLogger('[test]');
    logDebug('scope', 'debug msg');
    logInfo('scope', 'info msg');
    logWarn('scope', 'warn msg');
    logError('scope', 'error msg');
    assert.equal(calls.length, 4, 'all 4 calls should pass through at DEBUG level');
  });

  test('defaults to INFO when LOG_LEVEL is unset', () => {
    delete process.env.LOG_LEVEL;
    calls.length = 0;
    const { logDebug, logInfo } = createLogger('[test]');
    logDebug('scope', 'debug msg');
    logInfo('scope', 'info msg');
    assert.equal(calls.filter(c => c.method === 'debug').length, 0, 'debug suppressed by default');
    assert.equal(calls.filter(c => c.method === 'log').length, 1, 'info passes through by default');
  });

  test('log output includes scope and message', () => {
    process.env.LOG_LEVEL = 'info';
    calls.length = 0;
    const { logInfo } = createLogger('[myapp]');
    logInfo('my-scope', 'hello world');
    assert.equal(calls.length, 1);
    const [msg] = calls[0].args;
    assert.match(msg, /\[myapp\]/);
    assert.match(msg, /\[INFO\]/);
    assert.match(msg, /\[my-scope\]/);
    assert.match(msg, /hello world/);
  });
});

describe('createTypeConfig', () => {
  test('all doc types have command, dir function, and event', async () => {
    const { createTypeConfig } = await import('../../src/config/docTypes.js');
    const config = createTypeConfig('/tmp/test-docs');
    const types = ['feature', 'epic', 'story', 'spike', 'bug'];
    for (const t of types) {
      assert.ok(config[t], `${t} should exist`);
      assert.ok(typeof config[t].command === 'string', `${t}.command should be a string`);
      assert.ok(typeof config[t].dir === 'function', `${t}.dir should be a function`);
      assert.ok(typeof config[t].event === 'string', `${t}.event should be a string`);
    }
  });

  test('dir() returns path under the given docsRoot', async () => {
    const { createTypeConfig } = await import('../../src/config/docTypes.js');
    const config = createTypeConfig('/my/root');
    assert.ok(config.epic.dir().startsWith('/my/root'), 'epic dir should be under docsRoot');
    assert.ok(config.story.dir().includes('stories'), 'story dir should contain "stories"');
  });
});
