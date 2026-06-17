import fs from 'fs';
import path from 'path';
import type { BroadcastFn } from '../types.js';
import type { Logger } from '../utils/logger.js';
import { logAudit } from '../utils/auditLog.js';

const DEFAULT_MAX_RETRIES = 3;

interface InboxWatcherOptions {
  INBOX_DIR: string;
  EPICS_DIR: string;
  DOC_DIRS: string[];
  isClaimedByApi: (filename: string) => boolean;
  ensureDir: (dir: string) => void;
  loadCommand: (name: string) => string | null;
  callClaude: (prompt: string) => Promise<string>;
  broadcast: BroadcastFn;
  logInfo: Logger['logInfo'];
  logError: Logger['logError'];
}

export function watchInbox({
  INBOX_DIR,
  EPICS_DIR,
  DOC_DIRS,
  isClaimedByApi,
  ensureDir,
  loadCommand,
  callClaude,
  broadcast,
  logInfo,
  logError,
}: InboxWatcherOptions): { close(): void } {
  ensureDir(INBOX_DIR);
  const allDocDirs = DOC_DIRS || [EPICS_DIR];
  const _isClaimed = isClaimedByApi || (() => false);
  const maxRetries = Number(process.env.INBOX_MAX_RETRIES) || DEFAULT_MAX_RETRIES;

  // Skip if already saved to any doc dir OR if the API is currently generating it
  const shouldSkip = (filename: string): boolean =>
    _isClaimed(filename) || allDocDirs.some((dir) => fs.existsSync(path.join(dir, filename)));

  // Guard against concurrent processInboxFile calls for the same file
  const inFlight = new Set<string>();

  // Process existing inbox files sequentially to avoid spawning many claude subprocesses at once
  (async () => {
    const files = (await fs.promises.readdir(INBOX_DIR)).filter(isInboxFile);
    for (const f of files) {
      if (!shouldSkip(f)) await processInboxFile(f);
    }
  })();

  const watcher = fs.watch(INBOX_DIR, (event, filename) => {
    if (event !== 'rename' || !filename || !isInboxFile(filename)) return;
    setTimeout(() => {
      const exists = fs.existsSync(path.join(INBOX_DIR, filename));
      if (exists && !shouldSkip(filename)) processInboxFile(filename);
    }, 500);
  });

  logInfo('watchInbox', 'Watching /inbox for new files');

  async function processInboxFile(filename: string): Promise<void> {
    if (inFlight.has(filename)) return;
    inFlight.add(filename);
    try {
      logInfo('watchInbox', `New inbox file: ${filename}`);
      const t = Date.now();
      const inboxPath = path.join(INBOX_DIR, filename);
      const errorsDir = path.join(INBOX_DIR, 'errors');
      let lastError = '';
      const delays = [2000, 4000, 8000];

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const inboxContent = await fs.promises.readFile(inboxPath, 'utf-8');
          const epicTemplate = loadCommand('create-epics');
          const epicPrompt = epicTemplate
            ? epicTemplate.replace('$ARGUMENTS', `File: ${filename}\n\n${inboxContent}`)
            : `Generate a complete Epic using the COVE Framework. Output ONLY the markdown content.\n\nFile: ${filename}\n\n${inboxContent}`;
          const epicContent = await callClaude(epicPrompt);

          ensureDir(EPICS_DIR);
          await fs.promises.writeFile(path.join(EPICS_DIR, filename), epicContent);
          broadcast({ type: 'epic_created', filename });
          logAudit({ op: 'create', docType: 'epic', filename, source: 'inbox' });
          logInfo(
            'watchInbox',
            `Inbox processed ${filename} → epics/${filename} in ${Date.now() - t}ms`
          );
          return;
        } catch (err: unknown) {
          lastError = err instanceof Error ? err.message : String(err);
          logError(
            'watchInbox',
            `Attempt ${attempt}/${maxRetries} failed for ${filename}: ${lastError}`
          );
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, delays[attempt - 1] ?? 8000));
          }
        }
      }

      // All retries exhausted — move to errors dir
      try {
        ensureDir(errorsDir);
        await fs.promises.rename(inboxPath, path.join(errorsDir, filename));
        const errorMeta = {
          attempts: maxRetries,
          lastError,
          timestamp: new Date().toISOString(),
        };
        await fs.promises.writeFile(
          path.join(errorsDir, `${filename}.error.json`),
          JSON.stringify(errorMeta, null, 2)
        );
        broadcast({ type: 'inbox-error', filename, error: lastError });
        logError(
          'watchInbox',
          `Moved ${filename} to inbox/errors after ${maxRetries} failed attempts`
        );
      } catch (moveErr: unknown) {
        logError(
          'watchInbox',
          `Failed to move ${filename} to errors dir: ${moveErr instanceof Error ? moveErr.message : String(moveErr)}`
        );
      }
    } finally {
      inFlight.delete(filename);
    }
  }

  return { close: () => watcher.close() };
}

function isInboxFile(file: string): boolean {
  return file.endsWith('.md') && file !== '.gitkeep';
}
