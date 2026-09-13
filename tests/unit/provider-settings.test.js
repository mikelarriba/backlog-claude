// ── Unit tests: public/js/provider-settings.js ──────────────────────────────
// Pure model/provider/effort status-label formatting extracted from the
// Settings view's save-setting flow (#460). provider-settings.js only
// imports state.js and actions.js (no DOM-heavy transitive imports), so no
// module mocking is needed here — just the window shim state.js relies on.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';
import { formatModelStatusLabel } from '../../public/js/provider-settings.js';

const PROVIDERS = [
  { id: 'claude-cli', name: 'Claude CLI', models: [] },
  { id: 'ollama', name: 'Ollama', models: [] },
];

describe('formatModelStatusLabel()', () => {
  test('includes the model name when one is selected', () => {
    assert.equal(
      formatModelStatusLabel(PROVIDERS, 'claude-cli', 'claude-sonnet-5', ''),
      'Using Claude CLI / claude-sonnet-5'
    );
  });

  test('falls back to "default" when no model is selected', () => {
    assert.equal(
      formatModelStatusLabel(PROVIDERS, 'claude-cli', '', ''),
      'Using Claude CLI default'
    );
  });

  test('appends the effort level when one is set, with a model', () => {
    assert.equal(
      formatModelStatusLabel(PROVIDERS, 'ollama', 'llama3', 'high'),
      'Using Ollama / llama3 (effort: high)'
    );
  });

  test('appends the effort level when one is set, without a model', () => {
    assert.equal(
      formatModelStatusLabel(PROVIDERS, 'ollama', '', 'low'),
      'Using Ollama default (effort: low)'
    );
  });

  test('falls back to the raw provider id when it is not in the provider list', () => {
    assert.equal(
      formatModelStatusLabel(PROVIDERS, 'unknown-provider', '', ''),
      'Using unknown-provider default'
    );
  });

  test('omits the effort suffix entirely when effort is empty', () => {
    assert.equal(
      formatModelStatusLabel(PROVIDERS, 'claude-cli', 'model-x', ''),
      'Using Claude CLI / model-x'
    );
  });
});
