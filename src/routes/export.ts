// ── Server-side export: renders print-ready HTML pages ───────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { assertDocType, assertFilename, sendError, parseApiError } from '../utils/routeHelpers.js';
import {
  computeAutoLayout,
  type ChildData,
  type SprintEntry,
  type EpicMapEntry,
} from '../services/exportLayout.js';
import {
  buildDocPrintPage,
  buildRoadmapPrintPage,
  renderRoadmapTimeline,
  renderRoadmapCharts,
  renderRoadmapIssueTitles,
  renderRoadmapIssueDescs,
} from '../views/exportTemplates.js';
import type { RouteContext } from '../types.js';

export interface ExportRouteContext {
  rootDir: string;
  TYPE_CONFIG: RouteContext['TYPE_CONFIG'];
  docIndex: RouteContext['docIndex'];
}

// ── Route factory ─────────────────────────────────────────────────────────────

export default function exportRoutes({ rootDir, TYPE_CONFIG, docIndex }: ExportRouteContext) {
  const router = Router();

  const CANVAS_LAYOUT_PATH = path.join(rootDir, '.canvas-layout.json');
  const PI_SETTINGS_PATH = path.join(rootDir, '.pi-settings.json');

  async function loadCanvasLayout(): Promise<
    Record<string, Record<string, { col: number; row: number }>>
  > {
    try {
      if (fs.existsSync(CANVAS_LAYOUT_PATH))
        return JSON.parse(await fs.promises.readFile(CANVAS_LAYOUT_PATH, 'utf-8'));
    } catch {
      // Optional file — best-effort read; fall back to auto-layout if missing/corrupt.
    }
    return {};
  }

  async function loadPiSettings(): Promise<Record<string, unknown>> {
    try {
      if (fs.existsSync(PI_SETTINGS_PATH))
        return JSON.parse(await fs.promises.readFile(PI_SETTINGS_PATH, 'utf-8'));
    } catch {
      // Optional file — best-effort read; fall back to defaults if missing/corrupt.
    }
    return {};
  }

  // ── GET /api/export/doc/:type/:filename ──────────────────────────────────────
  router.get('/api/export/doc/:type/:filename', async (req, res) => {
    try {
      const docType = assertDocType(req.params.type, TYPE_CONFIG);
      const filename = assertFilename(req.params.filename);
      const cfg = TYPE_CONFIG[docType];
      const filepath = path.join(cfg.dir(), filename);

      if (!fs.existsSync(filepath)) {
        res.status(404).send('Document not found');
        return;
      }

      const epicContent = await fs.promises.readFile(filepath, 'utf-8');
      const epicDoc = docIndex
        .getAll()
        .find((d) => d.filename === filename && d.docType === docType);
      if (!epicDoc) {
        res.status(404).send('Document not in index');
        return;
      }

      const epicTitle = epicDoc.title || filename;
      const allDocs = docIndex.getAll();
      const children = allDocs.filter(
        (d) =>
          d.parentFilename === filename &&
          ['story', 'spike', 'bug', 'epic', 'feature'].includes(d.docType)
      );

      const childData: ChildData[] = await Promise.all(
        children.map(async (c) => {
          let content = '';
          try {
            const childCfg = TYPE_CONFIG[c.docType];
            if (childCfg) {
              const childPath = path.join(childCfg.dir(), c.filename);
              if (fs.existsSync(childPath))
                content = await fs.promises.readFile(childPath, 'utf-8');
            }
          } catch {
            // Best-effort read of a child doc's content; card renders without a body if unreadable.
          }
          return {
            filename: c.filename,
            docType: c.docType,
            title: c.title || c.filename,
            storyPoints: c.storyPoints,
            priority: c.priority || 'Medium',
            status: c.status || 'Draft',
            jiraId: c.jiraId,
            jiraUrl: c.jiraUrl,
            content,
          };
        })
      );

      // Build dependency edges among children
      const childFilenames = new Set(children.map((c) => c.filename));
      const blocks: Array<{ src: string; tgt: string }> = [];
      const parallel: Array<{ a: string; b: string }> = [];
      const seenParallel = new Set<string>();
      for (const child of children) {
        for (const fn of child.blocks || []) {
          if (childFilenames.has(fn)) blocks.push({ src: child.filename, tgt: fn });
        }
        for (const fn of child.parallel || []) {
          if (childFilenames.has(fn)) {
            const key = [child.filename, fn].sort().join('|');
            if (!seenParallel.has(key)) {
              seenParallel.add(key);
              parallel.push({ a: child.filename, b: fn });
            }
          }
        }
      }

      const canvasLayouts = await loadCanvasLayout();
      let layout: Record<string, { col: number; row: number }> =
        (canvasLayouts[filename] as Record<string, { col: number; row: number }>) || {};
      if (!Object.keys(layout).length && children.length) {
        layout = computeAutoLayout(children, blocks);
      }

      const totalSP = childData.reduce((sum, c) => sum + (c.storyPoints || 0), 0);

      const html = buildDocPrintPage({
        epicTitle,
        docType,
        totalSP,
        epicDoc,
        epicContent,
        childData,
        layout,
        blocks,
        parallel,
      });

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (err) {
      const apiErr = parseApiError(err, 'EXPORT_FAILED', 'Export failed');
      sendError(res, 400, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── GET /api/export/roadmap ──────────────────────────────────────────────────
  router.get('/api/export/roadmap', async (req, res) => {
    try {
      const piParam = String(req.query.pi || '');
      const includesParam = String(req.query.includes || 'roadmap,titles');
      const hideEmptyEpics = req.query.hideEmpty === '1';
      const sprintsParam = String(req.query.sprints || '');
      const teamsParam = String(req.query.teams || '');

      const includes = new Set(includesParam.split(',').map((s) => s.trim()));
      const includeRoadmap = includes.has('roadmap');
      const includeTitles = includes.has('titles');
      const includeDescs = includes.has('descriptions');
      const includeCharts = includes.has('charts');

      const piSettings = await loadPiSettings();
      const sprintConfig = (piSettings.sprints as Record<string, SprintEntry[]>) || {};

      // Resolve visible PIs
      const requestedPis = piParam
        ? piParam
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const allPiNames = Object.keys(sprintConfig);
      const visiblePis = new Set(requestedPis.length ? requestedPis : allPiNames);

      // Sprint & team filters
      const filterSprints = sprintsParam
        ? new Set(
            sprintsParam
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          )
        : null;
      const filterTeams = teamsParam
        ? new Set(
            teamsParam
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          )
        : null;

      // Gather sprints for visible PIs (filtered if sprint filter is active)
      const sprints: SprintEntry[] = [];
      const seenSprints = new Set<string>();
      for (const pi of allPiNames) {
        if (!visiblePis.has(pi)) continue;
        for (const s of sprintConfig[pi] || []) {
          if (!seenSprints.has(s.name)) {
            seenSprints.add(s.name);
            if (!filterSprints || filterSprints.has(s.name)) {
              sprints.push(s);
            }
          }
        }
      }

      const allDocs = docIndex.getAll();
      const leafTypes = new Set(['story', 'spike', 'bug']);
      const epicTypes = new Set(['epic']);

      const visibleLeafs = allDocs.filter(
        (d) =>
          leafTypes.has(d.docType) &&
          d.fixVersion &&
          visiblePis.has(d.fixVersion) &&
          (!filterSprints || filterSprints.has(d.sprint || '')) &&
          (!filterTeams || filterTeams.has(d.team || ''))
      );

      const epicMap = new Map<string, EpicMapEntry>();
      for (const leaf of visibleLeafs) {
        const key = leaf.parentFilename || '__none__';
        if (!epicMap.has(key)) {
          const epicDoc = leaf.parentFilename
            ? allDocs.find((d) => d.filename === leaf.parentFilename) || null
            : null;
          epicMap.set(key, { epicDoc, sprints: new Set(), storyCount: 0, totalSP: 0 });
        }
        const entry = epicMap.get(key)!;
        entry.storyCount++;
        entry.totalSP += Number(leaf.storyPoints) || 0;
        if (leaf.sprint) entry.sprints.add(leaf.sprint);
      }
      for (const d of allDocs) {
        if (epicTypes.has(d.docType) && !epicMap.has(d.filename)) {
          epicMap.set(d.filename, {
            epicDoc: d,
            sprints: new Set(),
            storyCount: 0,
            totalSP: 0,
          });
        }
      }

      const epicEntries = [...epicMap.entries()].sort(([ka, a], [kb, b]) => {
        if (ka === '__none__') return 1;
        if (kb === '__none__') return -1;
        const ra = a.epicDoc?.rank ?? 9999;
        const rb = b.epicDoc?.rank ?? 9999;
        if (ra !== rb) return ra - rb;
        return kb.localeCompare(ka);
      });

      const contentMap: Record<string, string> = {};
      if (includeDescs) {
        await Promise.all(
          visibleLeafs.map(async (d) => {
            try {
              const cfg = TYPE_CONFIG[d.docType];
              if (!cfg) return;
              const fp = path.join(cfg.dir(), d.filename);
              if (fs.existsSync(fp))
                contentMap[d.filename] = await fs.promises.readFile(fp, 'utf-8');
            } catch {
              // Best-effort read of an issue's description; entry renders as "No description" if unreadable.
            }
          })
        );
      }

      const piLabel = requestedPis.length
        ? requestedPis.join(' + ')
        : [(piSettings.currentPi as string) || '', (piSettings.nextPi as string) || '']
            .filter(Boolean)
            .join(' + ') || 'All';

      const dateStr = new Date().toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
      const totalSP = visibleLeafs.reduce((s, d) => s + (Number(d.storyPoints) || 0), 0);
      const issueCount = visibleLeafs.length;
      const epicCount = epicEntries.filter(([k]) => k !== '__none__').length;

      let sections = '';
      if (includeRoadmap) sections += renderRoadmapTimeline(sprints, epicEntries, hideEmptyEpics);
      if (includeCharts) sections += renderRoadmapCharts(visibleLeafs);
      if (includeTitles) sections += renderRoadmapIssueTitles(sprints, visibleLeafs, allDocs);
      if (includeDescs) sections += renderRoadmapIssueDescs(sprints, visibleLeafs, contentMap);

      const html = buildRoadmapPrintPage({
        piLabel,
        epicCount,
        issueCount,
        totalSP,
        dateStr,
        sections,
      });

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (err) {
      const apiErr = parseApiError(err, 'EXPORT_FAILED', 'Export failed');
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  return router;
}
