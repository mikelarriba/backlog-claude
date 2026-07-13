// ── Links business logic service ──────────────────────────────────────────────
// Contains the per-linkType business logic extracted from the links route.
// Routes are responsible for: validate → dispatch to service by linkType → respond.
import fs from 'fs';
import path from 'path';
import {
  setFrontmatterField,
  extractFrontmatterField,
  removeFrontmatterField,
} from '../utils/transforms.js';
import type { TypeConfig, DocIndexInstance, BroadcastFn } from '../types.js';
import type { Logger } from '../utils/logger.js';

interface LinksContext {
  TYPE_CONFIG: TypeConfig;
  FEATURES_DIR: string;
  EPICS_DIR: string;
  STORIES_DIR: string;
  SPIKES_DIR: string;
  BUGS_DIR: string;
  broadcast: BroadcastFn;
  logInfo: Logger['logInfo'];
  docIndex: DocIndexInstance;
}

export interface LinkResult {
  success: boolean;
  linkType?: string;
  sourceFilename?: string;
  targetFilename?: string;
  field?: string;
}

export interface LinkError {
  code: string;
  message: string;
  details?: unknown;
  status: number;
}

// ── Hierarchy link ────────────────────────────────────────────────────────────

export async function applyHierarchyLink(
  sourceType: string,
  sourceFilename: string,
  targetType: string,
  targetFilename: string,
  {
    TYPE_CONFIG,
    FEATURES_DIR,
    EPICS_DIR,
    STORIES_DIR,
    SPIKES_DIR,
    BUGS_DIR,
    broadcast,
    logInfo,
    docIndex,
  }: LinksContext
): Promise<LinkResult | LinkError> {
  const LINK_RULES: Record<
    string,
    { field: string; sourceDir: () => string; targetDir: () => string }
  > = {
    'epic→feature': {
      field: 'Feature_ID',
      sourceDir: () => EPICS_DIR,
      targetDir: () => FEATURES_DIR,
    },
    'story→epic': {
      field: 'Epic_ID',
      sourceDir: () => STORIES_DIR,
      targetDir: () => EPICS_DIR,
    },
    'spike→epic': {
      field: 'Epic_ID',
      sourceDir: () => SPIKES_DIR,
      targetDir: () => EPICS_DIR,
    },
    'bug→epic': {
      field: 'Epic_ID',
      sourceDir: () => BUGS_DIR,
      targetDir: () => EPICS_DIR,
    },
  };

  const key = `${sourceType}→${targetType}`;
  const rule = LINK_RULES[key];
  if (!rule) {
    return {
      code: 'INVALID_LINK',
      message: `Cannot link ${sourceType} → ${targetType}`,
      details: { allowed: Object.keys(LINK_RULES) },
      status: 400,
    };
  }

  const srcPath = path.join(rule.sourceDir(), sourceFilename);
  const tgtPath = path.join(rule.targetDir(), targetFilename);

  if (!fs.existsSync(srcPath))
    return { code: 'NOT_FOUND', message: 'Source document not found', status: 404 };
  if (!fs.existsSync(tgtPath))
    return { code: 'NOT_FOUND', message: 'Target document not found', status: 404 };

  const content = await fs.promises.readFile(srcPath, 'utf-8');
  const updated = setFrontmatterField(content, rule.field, targetFilename);
  await fs.promises.writeFile(srcPath, updated);
  await docIndex.invalidate(sourceType, sourceFilename);

  broadcast({
    type: 'link_updated',
    sourceType,
    sourceFilename,
    targetType,
    targetFilename,
  });
  logInfo('POST /api/link', `${sourceFilename} → ${targetFilename} (${rule.field})`);

  return { success: true, field: rule.field, targetFilename };
}

// ── Blocks link ───────────────────────────────────────────────────────────────

export async function applyBlocksLink(
  srcType: string,
  srcFile: string,
  tgtType: string,
  tgtFile: string,
  { TYPE_CONFIG, broadcast, logInfo, docIndex }: LinksContext
): Promise<LinkResult | LinkError> {
  const srcCfg = TYPE_CONFIG[srcType];
  const tgtCfg = TYPE_CONFIG[tgtType];
  if (!srcCfg)
    return { code: 'INVALID_TYPE', message: `Unknown type: ${srcType}`, status: 400 };
  if (!tgtCfg)
    return { code: 'INVALID_TYPE', message: `Unknown type: ${tgtType}`, status: 400 };
  if (srcFile === tgtFile)
    return { code: 'INVALID_LINK', message: 'A story cannot block itself', status: 400 };

  const srcPath = path.join(srcCfg.dir(), srcFile);
  const tgtPath = path.join(tgtCfg.dir(), tgtFile);
  if (!fs.existsSync(srcPath))
    return { code: 'NOT_FOUND', message: 'Source document not found', status: 404 };
  if (!fs.existsSync(tgtPath))
    return { code: 'NOT_FOUND', message: 'Target document not found', status: 404 };

  // BFS cycle detection: if we reach srcFile when traversing from tgtFile, reject
  const visited = new Set<string>();
  const queue = [tgtFile];
  while (queue.length) {
    const fn = queue.shift() as string;
    if (fn === srcFile) {
      return {
        code: 'CYCLE_DETECTED',
        message: `Adding this dependency would create a cycle: ${tgtFile} already (directly or transitively) blocks ${srcFile}`,
        status: 400,
      };
    }
    if (visited.has(fn)) continue;
    visited.add(fn);
    for (const blocked of docIndex.get(fn)?.blocks || []) queue.push(blocked);
  }

  // Append tgtFile to source's Blocks field
  const srcContent = await fs.promises.readFile(srcPath, 'utf-8');
  const existingBlocks = extractFrontmatterField(srcContent, 'Blocks');
  const blocksArr = existingBlocks
    ? existingBlocks
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  if (!blocksArr.includes(tgtFile)) {
    blocksArr.push(tgtFile);
    await fs.promises.writeFile(
      srcPath,
      setFrontmatterField(srcContent, 'Blocks', blocksArr.join(', '))
    );
    await docIndex.invalidate(srcType, srcFile);
  }

  // Append srcFile to target's Blocked_By field
  const tgtContent = await fs.promises.readFile(tgtPath, 'utf-8');
  const existingBlockedBy = extractFrontmatterField(tgtContent, 'Blocked_By');
  const blockedByArr = existingBlockedBy
    ? existingBlockedBy
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  if (!blockedByArr.includes(srcFile)) {
    blockedByArr.push(srcFile);
    await fs.promises.writeFile(
      tgtPath,
      setFrontmatterField(tgtContent, 'Blocked_By', blockedByArr.join(', '))
    );
    await docIndex.invalidate(tgtType, tgtFile);
  }

  broadcast({
    type: 'link_updated',
    linkType: 'blocks',
    sourceFilename: srcFile,
    targetFilename: tgtFile,
  });
  logInfo('POST /api/link', `${srcFile} blocks ${tgtFile}`);

  return { success: true, linkType: 'blocks', sourceFilename: srcFile, targetFilename: tgtFile };
}

// ── Parallel link ─────────────────────────────────────────────────────────────

export async function applyParallelLink(
  srcType: string,
  srcFile: string,
  tgtType: string,
  tgtFile: string,
  { TYPE_CONFIG, broadcast, logInfo, docIndex }: LinksContext
): Promise<LinkResult | LinkError> {
  const leafTypes = new Set(['story', 'spike', 'bug']);
  if (!leafTypes.has(srcType)) {
    return {
      code: 'INVALID_LINK',
      message: 'Only leaf types (story, spike, bug) can have parallel links',
      status: 400,
    };
  }
  if (!leafTypes.has(tgtType)) {
    return {
      code: 'INVALID_LINK',
      message: 'Only leaf types (story, spike, bug) can have parallel links',
      status: 400,
    };
  }
  if (srcFile === tgtFile) {
    return {
      code: 'INVALID_LINK',
      message: 'A story cannot be parallel with itself',
      status: 400,
    };
  }

  const srcCfg = TYPE_CONFIG[srcType];
  const tgtCfg = TYPE_CONFIG[tgtType];
  const srcPath = path.join(srcCfg.dir(), srcFile);
  const tgtPath = path.join(tgtCfg.dir(), tgtFile);
  if (!fs.existsSync(srcPath))
    return { code: 'NOT_FOUND', message: 'Source document not found', status: 404 };
  if (!fs.existsSync(tgtPath))
    return { code: 'NOT_FOUND', message: 'Target document not found', status: 404 };

  // Append tgtFile to source's Parallel field
  const srcContent = await fs.promises.readFile(srcPath, 'utf-8');
  const existingParallelSrc = extractFrontmatterField(srcContent, 'Parallel');
  const parallelSrcArr = existingParallelSrc
    ? existingParallelSrc
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  if (!parallelSrcArr.includes(tgtFile)) {
    parallelSrcArr.push(tgtFile);
    await fs.promises.writeFile(
      srcPath,
      setFrontmatterField(srcContent, 'Parallel', parallelSrcArr.join(', '))
    );
    await docIndex.invalidate(srcType, srcFile);
  }

  // Append srcFile to target's Parallel field (symmetric)
  const tgtContent = await fs.promises.readFile(tgtPath, 'utf-8');
  const existingParallelTgt = extractFrontmatterField(tgtContent, 'Parallel');
  const parallelTgtArr = existingParallelTgt
    ? existingParallelTgt
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  if (!parallelTgtArr.includes(srcFile)) {
    parallelTgtArr.push(srcFile);
    await fs.promises.writeFile(
      tgtPath,
      setFrontmatterField(tgtContent, 'Parallel', parallelTgtArr.join(', '))
    );
    await docIndex.invalidate(tgtType, tgtFile);
  }

  broadcast({
    type: 'link_updated',
    linkType: 'parallel',
    sourceFilename: srcFile,
    targetFilename: tgtFile,
  });
  logInfo('POST /api/link', `${srcFile} parallel ${tgtFile}`);

  return {
    success: true,
    linkType: 'parallel',
    sourceFilename: srcFile,
    targetFilename: tgtFile,
  };
}

// ── Delete blocks link ────────────────────────────────────────────────────────

export async function removeBlocksLink(
  srcType: string,
  srcFile: string,
  tgtType: string,
  tgtFile: string,
  { TYPE_CONFIG, broadcast, logInfo, docIndex }: LinksContext
): Promise<void> {
  const srcCfg = TYPE_CONFIG[srcType];
  const tgtCfg = TYPE_CONFIG[tgtType];
  const srcPath = srcCfg ? path.join(srcCfg.dir(), srcFile) : null;
  const tgtPath = tgtCfg ? path.join(tgtCfg.dir(), tgtFile) : null;

  if (srcPath && fs.existsSync(srcPath)) {
    const srcContent = await fs.promises.readFile(srcPath, 'utf-8');
    const existing = extractFrontmatterField(srcContent, 'Blocks') || '';
    const filtered = existing
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && s !== tgtFile && s !== 'TBD');
    const updated = filtered.length
      ? setFrontmatterField(srcContent, 'Blocks', filtered.join(', '))
      : removeFrontmatterField(srcContent, 'Blocks');
    await fs.promises.writeFile(srcPath, updated);
    await docIndex.invalidate(srcType, srcFile);
  }

  if (tgtPath && fs.existsSync(tgtPath)) {
    const tgtContent = await fs.promises.readFile(tgtPath, 'utf-8');
    const existing = extractFrontmatterField(tgtContent, 'Blocked_By') || '';
    const filtered = existing
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && s !== srcFile && s !== 'TBD');
    const updated = filtered.length
      ? setFrontmatterField(tgtContent, 'Blocked_By', filtered.join(', '))
      : removeFrontmatterField(tgtContent, 'Blocked_By');
    await fs.promises.writeFile(tgtPath, updated);
    await docIndex.invalidate(tgtType, tgtFile);
  }

  broadcast({
    type: 'link_updated',
    linkType: 'blocks',
    sourceFilename: srcFile,
    targetFilename: tgtFile,
  });
  logInfo('DELETE /api/link', `removed blocks: ${srcFile} → ${tgtFile}`);
}

// ── Delete parallel link ──────────────────────────────────────────────────────

export async function removeParallelLink(
  srcType: string,
  srcFile: string,
  tgtType: string,
  tgtFile: string,
  { TYPE_CONFIG, broadcast, logInfo, docIndex }: LinksContext
): Promise<void> {
  const srcCfg = TYPE_CONFIG[srcType];
  const tgtCfg = TYPE_CONFIG[tgtType];
  const srcPath = srcCfg ? path.join(srcCfg.dir(), srcFile) : null;
  const tgtPath = tgtCfg ? path.join(tgtCfg.dir(), tgtFile) : null;

  if (srcPath && fs.existsSync(srcPath)) {
    const srcContent = await fs.promises.readFile(srcPath, 'utf-8');
    const existing = extractFrontmatterField(srcContent, 'Parallel') || '';
    const filtered = existing
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && s !== tgtFile && s !== 'TBD');
    const updated = filtered.length
      ? setFrontmatterField(srcContent, 'Parallel', filtered.join(', '))
      : removeFrontmatterField(srcContent, 'Parallel');
    await fs.promises.writeFile(srcPath, updated);
    await docIndex.invalidate(srcType, srcFile);
  }

  if (tgtPath && fs.existsSync(tgtPath)) {
    const tgtContent = await fs.promises.readFile(tgtPath, 'utf-8');
    const existing = extractFrontmatterField(tgtContent, 'Parallel') || '';
    const filtered = existing
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && s !== srcFile && s !== 'TBD');
    const updated = filtered.length
      ? setFrontmatterField(tgtContent, 'Parallel', filtered.join(', '))
      : removeFrontmatterField(tgtContent, 'Parallel');
    await fs.promises.writeFile(tgtPath, updated);
    await docIndex.invalidate(tgtType, tgtFile);
  }

  broadcast({
    type: 'link_updated',
    linkType: 'parallel',
    sourceFilename: srcFile,
    targetFilename: tgtFile,
  });
  logInfo('DELETE /api/link', `removed parallel: ${srcFile} ↔ ${tgtFile}`);
}

export type { LinksContext };
