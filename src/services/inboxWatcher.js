import fs from 'fs';
import path from 'path';

export function watchInbox({
  INBOX_DIR,
  EPICS_DIR,
  ensureDir,
  loadCommand,
  callClaude,
  broadcast,
  logInfo,
  logError,
}) {
  ensureDir(INBOX_DIR);

  for (const f of fs.readdirSync(INBOX_DIR).filter(isInboxFile)) {
    if (!fs.existsSync(path.join(EPICS_DIR, f))) processInboxFile(f);
  }

  fs.watch(INBOX_DIR, (event, filename) => {
    if (event !== 'rename' || !filename || !isInboxFile(filename)) return;
    setTimeout(() => {
      const exists = fs.existsSync(path.join(INBOX_DIR, filename));
      const already = fs.existsSync(path.join(EPICS_DIR, filename));
      if (exists && !already) processInboxFile(filename);
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
