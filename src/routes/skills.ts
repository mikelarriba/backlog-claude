// ── Skills routes: list, read, save, reset command templates ─────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { loadCommandRaw, loadProductContext } from '../services/claudeService.js';
import { buildImprovePrompt } from '../services/aiPromptBuilder.js';
import { validateBody } from '../utils/validateMiddleware.js';
import { sendError } from '../utils/routeHelpers.js';
import {
  KNOWN_SKILLS,
  SkillNameSchema,
  SkillSaveSchema,
  SkillImproveSchema,
  ProductContextSaveSchema,
} from '../schemas/skills.js';
import type { SkillsRouteContext } from '../types.js';

/** Extract name and description from YAML frontmatter. */
function parseFrontmatter(content: string): { name: string; description: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { name: '', description: '' };
  const fm = match[1];
  const nameMatch = fm.match(/^name:\s*(.+)$/m);
  const descMatch = fm.match(/^description:\s*['"]?([\s\S]*?)['"]?\s*$/m);
  return {
    name: nameMatch ? nameMatch[1].trim() : '',
    description: descMatch ? descMatch[1].trim() : '',
  };
}

export default function skillsRoutes({
  rootDir,
  broadcast,
  callClaude,
  logInfo,
}: SkillsRouteContext) {
  const router = Router();
  const commandsDir = path.join(rootDir, '.claude', 'commands');

  // ── List all skills ──────────────────────────────────────────────────────
  router.get('/api/skills', (_req, res) => {
    const skills = KNOWN_SKILLS.map((skillName) => {
      const raw = loadCommandRaw(rootDir, skillName);
      if (!raw)
        return { name: skillName, description: '', content: '', source: 'example' as const };
      const { description } = parseFrontmatter(raw.content);
      return { name: skillName, description, content: raw.content, source: raw.source };
    });
    res.json({ skills });
  });

  // ── Get single skill ─────────────────────────────────────────────────────
  router.get('/api/skills/:name', (req, res) => {
    const parsed = SkillNameSchema.safeParse(req.params.name);
    if (!parsed.success)
      return sendError(res, 400, 'VALIDATION_ERROR', `Unknown skill: ${req.params.name}`);
    const raw = loadCommandRaw(rootDir, parsed.data);
    if (!raw) return sendError(res, 404, 'NOT_FOUND', `Skill not found: ${parsed.data}`);
    const { description } = parseFrontmatter(raw.content);
    res.json({ name: parsed.data, description, content: raw.content, source: raw.source });
  });

  // ── Save / update a skill ────────────────────────────────────────────────
  router.put('/api/skills/:name', validateBody(SkillSaveSchema), (req, res) => {
    const parsed = SkillNameSchema.safeParse(req.params.name);
    if (!parsed.success)
      return sendError(res, 400, 'VALIDATION_ERROR', `Unknown skill: ${req.params.name}`);

    const skillName = parsed.data;
    const { content } = req.body as { content: string };

    // Ensure commands directory exists
    fs.mkdirSync(commandsDir, { recursive: true });
    const filePath = path.join(commandsDir, `${skillName}.md`);
    fs.writeFileSync(filePath, content, 'utf-8');

    broadcast({ type: 'skill_updated', name: skillName });
    logInfo('PUT /api/skills', `Saved skill: ${skillName}`);

    const { description } = parseFrontmatter(content);
    res.json({ success: true, name: skillName, description, source: 'custom' });
  });

  // ── Reset a skill (delete custom, revert to example) ─────────────────────
  router.delete('/api/skills/:name', (req, res) => {
    const parsed = SkillNameSchema.safeParse(req.params.name);
    if (!parsed.success)
      return sendError(res, 400, 'VALIDATION_ERROR', `Unknown skill: ${req.params.name}`);

    const skillName = parsed.data;
    const filePath = path.join(commandsDir, `${skillName}.md`);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    broadcast({ type: 'skill_reset', name: skillName });
    logInfo('DELETE /api/skills', `Reset skill to example: ${skillName}`);

    // Return the example template content
    const raw = loadCommandRaw(rootDir, skillName);
    const content = raw?.content ?? '';
    const { description } = parseFrontmatter(content);
    res.json({ success: true, name: skillName, description, content, source: 'example' });
  });

  // ── AI Improve a skill ───────────────────────────────────────────────────
  router.put('/api/skills/:name/improve', validateBody(SkillImproveSchema), async (req, res) => {
    const parsed = SkillNameSchema.safeParse(req.params.name);
    if (!parsed.success)
      return sendError(res, 400, 'VALIDATION_ERROR', `Unknown skill: ${req.params.name}`);

    const { content } = req.body as { content: string };
    const prompt = buildImprovePrompt(content);

    try {
      const improved = await callClaude(prompt);
      logInfo('PUT /api/skills/:name/improve', `Improved skill: ${parsed.data}`);
      res.json({ improved });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'AI call failed';
      sendError(res, 502, 'AI_ERROR', message);
    }
  });

  // ── Product Context ──────────────────────────────────────────────────────
  router.get('/api/settings/product-context', (_req, res) => {
    const ctx = loadProductContext(rootDir);
    res.json({ content: ctx.content, source: ctx.source });
  });

  router.put(
    '/api/settings/product-context',
    validateBody(ProductContextSaveSchema),
    (req, res) => {
      const { content } = req.body as { content: string };
      const filePath = path.join(rootDir, '.product-context.md');
      fs.writeFileSync(filePath, content, 'utf-8');

      broadcast({ type: 'product_context_updated' });
      logInfo('PUT /api/settings/product-context', 'Saved product context');
      res.json({ success: true, source: 'custom' });
    }
  );

  router.delete('/api/settings/product-context', (_req, res) => {
    const filePath = path.join(rootDir, '.product-context.md');
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    broadcast({ type: 'product_context_reset' });
    logInfo('DELETE /api/settings/product-context', 'Reset product context to example');

    const ctx = loadProductContext(rootDir);
    res.json({ success: true, content: ctx.content, source: 'example' });
  });

  return router;
}
