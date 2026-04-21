// ── Test app factory ──────────────────────────────────────────────────────────
// Sets isolated env vars, dynamically imports the server, and starts it on a
// random port. Must be called inside a before() hook so env vars are in place
// before server.js is first loaded in this process.

import http from 'node:http';
import fs   from 'node:fs';
import os   from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function startTestApp() {
  // Isolated temp dirs so tests never touch real docs/
  const tmpRoot  = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-test-'));
  const docsRoot = path.join(tmpRoot, 'docs');
  const inboxDir = path.join(tmpRoot, 'inbox');
  fs.mkdirSync(docsRoot, { recursive: true });
  fs.mkdirSync(inboxDir, { recursive: true });

  process.env.TEST_DOCS_ROOT  = docsRoot;
  process.env.TEST_INBOX_DIR  = inboxDir;
  process.env.MOCK_CLAUDE     = '1';
  // Ensure .env does not inject a real JIRA token into tests.
  // The empty string is intentional; the server guards check for a truthy value.
  process.env.JIRA_API_TOKEN  = '';

  // Dynamic import: env vars must be set before server.js module-level code runs.
  // Each test file runs in its own process (node --test), so the module cache is
  // always fresh when this is called for the first time in a file.
  const serverPath = path.resolve(__dirname, '../../server.js');
  const { app } = await import(serverPath);

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const { port } = server.address();

  async function api(method, urlPath, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res  = await fetch(`http://localhost:${port}${urlPath}`, opts);
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }

  async function stop() {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.TEST_DOCS_ROOT;
    delete process.env.TEST_INBOX_DIR;
    delete process.env.MOCK_CLAUDE;
    delete process.env.JIRA_API_TOKEN;
  }

  return { api, stop, docsRoot, inboxDir };
}
