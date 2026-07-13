// ── AI document generation service ────────────────────────────────────────────
// Contains the business logic extracted from docs-ai routes.
// Routes are responsible for: validation, SSE setup, calling service, streaming.
import fs from 'fs';
import path from 'path';
import { ensureDir } from '../utils/routeHelpers.js';
import { normalizeOutput } from './claudeService.js';
import {
  buildGeneratePrompt,
  buildUpgradePrompt,
  buildSplitStoryPrompt,
} from './aiPromptBuilder.js';
import { logAudit } from '../utils/auditLog.js';
import {
  isoDate,
  slugify,
  extractTitle,
  extractWorkflowStatus,
  setFrontmatterField,
  extractFrontmatterField,
} from '../utils/transforms.js';
import { stripControls } from '../utils/docHelpers.js';
import type { TypeConfig, DocIndexInstance, BroadcastFn } from '../types.js';
import type { Logger } from '../utils/logger.js';

interface AiServiceContext {
  TYPE_CONFIG: TypeConfig;
  INBOX_DIR: string;
  broadcast: BroadcastFn;
  loadCommand: (name: string) => string | null;
  callClaude: (prompt: string) => Promise<string>;
  streamClaude: (prompt: string, onChunk: (chunk: string) => void) => Promise<void>;
  _apiInFlight: Set<string>;
  logInfo: Logger['logInfo'];
  logError: Logger['logError'];
  docIndex: DocIndexInstance;
}

// ── generate ──────────────────────────────────────────────────────────────────

export interface GenerateDocParams {
  rawTitle?: string;
  rawIdea: string;
  priority?: string;
  type?: string;
  parentFeature?: string;
  parentEpic?: string;
  fixVersion?: string;
  team?: string;
  workCategory?: string;
  pi?: string;
}

export interface GenerateDocResult {
  filename: string;
  docType: string;
}

export async function generateDoc(
  params: GenerateDocParams,
  {
    TYPE_CONFIG,
    INBOX_DIR,
    broadcast,
    loadCommand,
    callClaude,
    _apiInFlight,
    logInfo,
    docIndex,
  }: AiServiceContext
): Promise<GenerateDocResult> {
  const {
    rawTitle,
    rawIdea,
    priority = 'Medium',
    type = 'epic',
    parentFeature,
    parentEpic,
    fixVersion,
    team,
    workCategory,
    pi,
  } = params;

  const title = rawTitle ? stripControls(rawTitle) : rawTitle;
  const idea = stripControls(rawIdea);
  const normalizedType = type; // caller is expected to have validated the type already

  const cfg = TYPE_CONFIG[normalizedType];
  const date = isoDate();
  const slug = slugify(title || idea.slice(0, 40));
  const filename = `${date}-${slug}.md`;

  const rawContent = `---
JIRA_ID: TBD
Story_Points: TBD
Status: Inbox — Awaiting Refinement
Priority: ${priority}
Created: ${new Date().toISOString()}
---

# ${title?.trim() || 'Untitled'}

## Raw Idea

${idea.trim()}
`;

  _apiInFlight.add(filename);
  const _genStart = Date.now();
  try {
    ensureDir(INBOX_DIR);
    await fs.promises.writeFile(path.join(INBOX_DIR, filename), rawContent);

    const prompt = buildGeneratePrompt(type, loadCommand(cfg.command), filename, rawContent);
    const generatedContent = await callClaude(prompt);

    const destDir = cfg.dir();
    ensureDir(destDir);
    let finalContent = setFrontmatterField(generatedContent, 'Status', 'Draft');
    if (normalizedType === 'epic' && parentFeature) {
      finalContent = setFrontmatterField(finalContent, 'Feature_ID', parentFeature);
    }
    if (['story', 'spike', 'bug'].includes(normalizedType) && parentEpic) {
      finalContent = setFrontmatterField(finalContent, 'Epic_ID', parentEpic);
    }
    if (fixVersion && fixVersion !== 'TBD') {
      finalContent = setFrontmatterField(finalContent, 'Fix_Version', fixVersion);
    }
    if (team && team !== 'TBD') {
      finalContent = setFrontmatterField(finalContent, 'Team', team);
    }
    if (workCategory && workCategory !== 'TBD') {
      finalContent = setFrontmatterField(finalContent, 'Work_Category', workCategory);
    }
    if (pi && pi !== 'TBD') {
      finalContent = setFrontmatterField(finalContent, 'PI', pi);
    }
    await fs.promises.writeFile(path.join(destDir, filename), finalContent);
    await docIndex.invalidate(normalizedType, filename);
  } finally {
    _apiInFlight.delete(filename);
  }

  broadcast({
    type: cfg.event,
    filename,
    docType: normalizedType,
    doc: docIndex.get(filename),
  });
  logAudit({
    op: 'create',
    docType: normalizedType,
    filename,
    fields: { title: title || rawIdea.slice(0, 60) },
    source: 'api',
  });
  logInfo(
    'POST /api/generate',
    `Generated ${normalizedType}/${filename} in ${Date.now() - _genStart}ms`
  );

  return { filename, docType: normalizedType };
}

// ── upgrade ───────────────────────────────────────────────────────────────────

export interface UpgradeDocParams {
  filepath: string;
  filename: string;
  docType: string;
  feedback: string;
  INBOX_DIR: string;
}

export interface UpgradeDocResult {
  fullContent: string;
}

export async function upgradeDoc(
  params: UpgradeDocParams,
  { streamClaude, docIndex }: Pick<AiServiceContext, 'streamClaude' | 'docIndex'>,
  onChunk: (chunk: string) => void
): Promise<UpgradeDocResult> {
  const { filepath, filename, docType, feedback, INBOX_DIR } = params;

  const currentContent = await fs.promises.readFile(filepath, 'utf-8');
  const currentStatus = extractWorkflowStatus(currentContent);

  const inboxPath = path.join(INBOX_DIR, filename);
  const inboxExists = fs.existsSync(inboxPath);
  const inboxHistory = inboxExists
    ? `\n\nOriginal idea and upgrade history (for context):\n---\n${await fs.promises.readFile(inboxPath, 'utf-8')}\n---`
    : '';

  const upgradePrompt = buildUpgradePrompt(docType, currentContent, feedback, inboxHistory);

  let fullContent = '';
  await streamClaude(upgradePrompt, (chunk: string) => {
    fullContent += chunk;
    onChunk(chunk);
  });

  fullContent = normalizeOutput(fullContent);
  fullContent = setFrontmatterField(fullContent, 'Status', currentStatus);
  await fs.promises.writeFile(filepath, fullContent);
  await docIndex.invalidate(docType, filename);

  if (inboxExists) {
    const note = `\n\n---\n\n## Upgrade Note — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}\n\n${feedback.trim()}\n`;
    await fs.promises.appendFile(inboxPath, note);
  }

  return { fullContent };
}

// ── split-story ───────────────────────────────────────────────────────────────

export interface SplitStoryParams {
  filepath: string;
  filename: string;
  docType: string;
  count: number;
  sprints: string[];
}

export interface SplitStoryResult {
  createdFiles: Array<{ filename: string; title: string; sprint: string | null }>;
  deletedOriginal: string;
}

export async function splitStory(
  params: SplitStoryParams,
  {
    TYPE_CONFIG,
    broadcast,
    streamClaude,
    logInfo,
    docIndex,
  }: Pick<AiServiceContext, 'TYPE_CONFIG' | 'broadcast' | 'streamClaude' | 'logInfo' | 'docIndex'>,
  onChunk: (chunk: string) => void
): Promise<SplitStoryResult> {
  const { filepath, filename, docType, count, sprints } = params;
  const cfg = TYPE_CONFIG[docType];

  const content = await fs.promises.readFile(filepath, 'utf-8');

  const epicId = extractFrontmatterField(content, 'Epic_ID') || 'TBD';
  const fixVersion = extractFrontmatterField(content, 'Fix_Version') || 'TBD';
  const priority = extractFrontmatterField(content, 'Priority') || 'Medium';
  const currentSP = Number(extractFrontmatterField(content, 'Story_Points')) || 0;
  const perStorySP = currentSP ? Math.round(currentSP / count) : 'TBD';

  const sprintList = sprints.length
    ? sprints.map((s, i) => `Part ${i + 1} → sprint: "${s}"`).join(', ')
    : `assign all parts to the same sprint as the original`;

  const splitPrompt = buildSplitStoryPrompt({
    content,
    count,
    epicId,
    fixVersion,
    priority,
    perStorySP,
    sprintList,
  });

  let fullOutput = '';
  await streamClaude(splitPrompt, (chunk: string) => {
    fullOutput += chunk;
    onChunk(chunk);
  });

  fullOutput = normalizeOutput(fullOutput);

  const parts = fullOutput
    .split(/^===SPLIT===/m)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (parts.length < 2) {
    throw new Error(
      `Claude returned ${parts.length} part(s) — expected ${count}. Please try again.`
    );
  }

  const date = isoDate();
  const createdFiles: Array<{ filename: string; title: string; sprint: string | null }> = [];

  for (let i = 0; i < parts.length; i++) {
    let part = normalizeOutput(parts[i]);

    if (sprints[i]) {
      part = setFrontmatterField(part, 'Sprint', sprints[i]);
    }

    const title = extractTitle(part) || `Part ${i + 1} of ${filename.replace(/\.md$/, '')}`;
    const slug = slugify(title);
    const newName = `${date}-${slug}.md`;
    const destPath = path.join(cfg.dir(), newName);

    await fs.promises.writeFile(destPath, part);
    await docIndex.invalidate(docType, newName);
    broadcast({
      type: `${docType}_created`,
      filename: newName,
      docType,
      doc: docIndex.get(newName),
    });
    createdFiles.push({ filename: newName, title, sprint: sprints[i] || null });
  }

  await fs.promises.unlink(filepath);
  await docIndex.invalidateAll();
  broadcast({ type: 'doc_deleted', filename, docType });

  logInfo('POST /api/docs/split-story', `Split ${filename} into ${createdFiles.length} parts`);

  return { createdFiles, deletedOriginal: filename };
}

// ── split-epic ────────────────────────────────────────────────────────────────

export interface SplitEpicParams {
  epicFilename: string;
  description: string;
}

export interface SplitEpicResult {
  featureFilename: string;
  featureTitle: string | null;
  newEpicFilename: string;
  featureCreated: boolean;
}

export async function splitEpic(
  params: SplitEpicParams,
  {
    TYPE_CONFIG,
    INBOX_DIR,
    broadcast,
    loadCommand,
    callClaude,
    _apiInFlight,
    logInfo,
    docIndex,
  }: AiServiceContext
): Promise<SplitEpicResult> {
  const { epicFilename, description } = params;
  const epicCfg = TYPE_CONFIG.epic;
  const epicPath = path.join(epicCfg.dir(), epicFilename);

  const epicContent = await fs.promises.readFile(epicPath, 'utf-8');
  const epicTitle = extractTitle(epicContent) || epicFilename;
  const epicPriority = extractFrontmatterField(epicContent, 'Priority') || 'Medium';
  const epicFixVer = extractFrontmatterField(epicContent, 'Fix_Version');
  const epicPi = extractFrontmatterField(epicContent, 'PI');
  const epicTeam = extractFrontmatterField(epicContent, 'Team');
  const epicWorkCat = extractFrontmatterField(epicContent, 'Work_Category');
  const featureId = extractFrontmatterField(epicContent, 'Feature_ID');

  let featureFilename: string | null;
  let featureCreated = false;
  let featureTitle: string | null;

  // Step 1: Resolve or create the parent Feature
  if (!featureId || featureId === 'TBD') {
    const featureCfg = TYPE_CONFIG.feature;
    const date = isoDate();
    const slug = slugify(epicTitle);
    featureFilename = `${date}-${slug}.md`;
    featureTitle = epicTitle;

    const featureContent = `---
JIRA_ID: TBD
Story_Points: TBD
Status: Draft
Priority: ${epicPriority}
Created: ${date}
---

## ${epicTitle}

## Context

Auto-created feature to group related epics split from: ${epicTitle}.

## Objective

TBD — refine after reviewing the epics grouped under this feature.

## Value

TBD

## Execution

1. **Epic:** ${epicTitle} — original epic
2. **Epic:** (new) — split from original

## Out of Scope

TBD
`;

    ensureDir(featureCfg.dir());
    await fs.promises.writeFile(path.join(featureCfg.dir(), featureFilename), featureContent);
    await docIndex.invalidate('feature', featureFilename);
    broadcast({
      type: 'feature_created',
      filename: featureFilename,
      docType: 'feature',
      doc: docIndex.get(featureFilename),
    });

    const updated = setFrontmatterField(epicContent, 'Feature_ID', featureFilename);
    await fs.promises.writeFile(epicPath, updated);
    await docIndex.invalidate('epic', epicFilename);

    featureCreated = true;

    logInfo(
      'POST /api/split-epic',
      `Auto-created feature ${featureFilename} for epic ${epicFilename}`
    );
  } else {
    featureFilename = featureId;
    const featureCfg = TYPE_CONFIG.feature;
    const featurePath = path.join(featureCfg.dir(), featureFilename);
    if (fs.existsSync(featurePath)) {
      featureTitle =
        extractTitle(await fs.promises.readFile(featurePath, 'utf-8')) || featureFilename;
    } else {
      featureTitle = featureFilename;
    }
  }

  // Step 2: Generate new epic via AI
  const idea = stripControls(
    `${description.trim()}\n\n---\nContext from original epic:\n${epicContent}`
  );

  const date = isoDate();
  const slug = slugify(description.slice(0, 40));
  const newEpicFilename = `${date}-${slug}.md`;

  const rawContent = `---
JIRA_ID: TBD
Story_Points: TBD
Status: Inbox — Awaiting Refinement
Priority: ${epicPriority}
Created: ${new Date().toISOString()}
---

# ${description.trim().slice(0, 80)}

## Raw Idea

${idea}
`;

  _apiInFlight.add(newEpicFilename);
  try {
    ensureDir(INBOX_DIR);
    await fs.promises.writeFile(path.join(INBOX_DIR, newEpicFilename), rawContent);

    const prompt = buildGeneratePrompt(
      'epic',
      loadCommand(epicCfg.command),
      newEpicFilename,
      rawContent
    );
    const generatedContent = await callClaude(prompt);

    const destDir = epicCfg.dir();
    ensureDir(destDir);
    let finalContent = setFrontmatterField(generatedContent, 'Status', 'Draft');
    finalContent = setFrontmatterField(finalContent, 'Feature_ID', featureFilename!);
    if (epicFixVer && epicFixVer !== 'TBD')
      finalContent = setFrontmatterField(finalContent, 'Fix_Version', epicFixVer);
    if (epicPi && epicPi !== 'TBD') finalContent = setFrontmatterField(finalContent, 'PI', epicPi);
    if (epicTeam && epicTeam !== 'TBD')
      finalContent = setFrontmatterField(finalContent, 'Team', epicTeam);
    if (epicWorkCat && epicWorkCat !== 'TBD')
      finalContent = setFrontmatterField(finalContent, 'Work_Category', epicWorkCat);
    await fs.promises.writeFile(path.join(destDir, newEpicFilename), finalContent);
    await docIndex.invalidate('epic', newEpicFilename);
  } finally {
    _apiInFlight.delete(newEpicFilename);
  }

  broadcast({
    type: 'epic_created',
    filename: newEpicFilename,
    docType: 'epic',
    doc: docIndex.get(newEpicFilename),
  });
  logInfo(
    'POST /api/split-epic',
    `Split epic ${epicFilename} → new epic ${newEpicFilename}, feature ${featureFilename}`
  );

  return {
    featureFilename: featureFilename!,
    featureTitle,
    newEpicFilename,
    featureCreated,
  };
}
