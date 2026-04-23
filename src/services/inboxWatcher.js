import fs from 'fs';
import path from 'path';

export function watchInbox({
  INBOX_DIR,
  EPICS_DIR,
  DOC_DIRS,        // all doc dirs to check — skip if file already exists in any of them
  isClaimedByApi,  // fn(filename) → true while the API is mid-generation for this file
  ensureDir,
  loadCommand,
  callClaude,
  broadcast,
  logInfo,
  logError,
}) {
  ensureDir(INBOX_DIR);
  const allDocDirs   = DOC_DIRS || [EPICS_DIR];
  const _isClaimed   = isClaimedByApi || (() => false);

  // Skip if already saved to any doc dir OR if the API is currently generating it
  const shouldSkip = (filename) =>
    _isClaimed(filename) ||
    allDocDirs.some(dir => fs.existsSync(path.join(dir, filename)));

  for (const f of fs.readdirSync(INBOX_DIR).filter(isInboxFile)) {
    if (!shouldSkip(f)) processInboxFile(f);
  }

  fs.watch(INBOX_DIR, (event, filename) => {
    if (event !== 'rename' || !filename || !isInboxFile(filename)) return;
    setTimeout(() => {
      const exists = fs.existsSync(path.join(INBOX_DIR, filename));
      if (exists && !shouldSkip(filename)) processInboxFile(filename);
    }, 500);
  });

  logInfo('watchInbox', 'Watching /inbox for new files');

  async function processInboxFile(filename) {
    logInfo('watchInbox', `New inbox file: ${filename}`);
    try {
      const inboxContent = fs.readFileSync(path.join(INBOX_DIR, filename), 'utf-8');
      const epicTemplate = loadCommand('create-epics');
      const epicPrompt = epicTemplate
        ? epicTemplate.replace('$ARGUMENTS', `File: ${filename}\n\n${inboxContent}`)
        : `Generate a complete Epic using the COVE Framework. Output ONLY the markdown content.\n\nFile: ${filename}\n\n${inboxContent}`;
      const epicContent = await callClaude(epicPrompt);

      ensureDir(EPICS_DIR);
      fs.writeFileSync(path.join(EPICS_DIR, filename), epicContent);
      broadcast({ type: 'epic_created', filename });
      logInfo('watchInbox', `Epic saved: docs/epics/${filename}`);
    } catch (err) {
      logError('watchInbox', `Failed to process ${filename}`, { error: err.message });
    }
  }
}

function isInboxFile(file) {
  return file.endsWith('.md') && file !== '.gitkeep';
}
