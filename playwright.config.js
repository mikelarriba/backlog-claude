import { defineConfig } from '@playwright/test';
import os from 'os';
import path from 'path';
import fs from 'fs';

const E2E_DOCS_ROOT = path.join(os.tmpdir(), 'backlog-e2e-docs');
const E2E_INBOX_DIR = path.join(os.tmpdir(), 'backlog-e2e-inbox');

// Create isolated doc directories before the server starts
for (const sub of ['features', 'epics', 'stories', 'spikes', 'bugs']) {
  fs.mkdirSync(path.join(E2E_DOCS_ROOT, sub), { recursive: true });
}
fs.mkdirSync(E2E_INBOX_DIR, { recursive: true });

export default defineConfig({
  testDir: './tests/e2e',
  webServer: {
    command: 'node server.js',
    port: 3000,
    reuseExistingServer: !process.env.CI,
    env: {
      TEST_DOCS_ROOT: E2E_DOCS_ROOT,
      TEST_INBOX_DIR: E2E_INBOX_DIR,
      MOCK_CLAUDE: '1',
    },
  },
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
  },
  timeout: 30000,
});
