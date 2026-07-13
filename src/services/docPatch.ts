// ── Document patch helper ──────────────────────────────────────────────────────
// Encapsulates the read → frontmatter-patch → write sequence that is repeated
// in every batch-mutation route.  Callers are responsible for index invalidation
// and broadcasting SSE events because the strategy differs per endpoint
// (per-item `invalidate` vs. a single `invalidateAll` after the batch).
import fs from 'fs';
import { setFrontmatterField } from '../utils/transforms.js';

/**
 * Read a markdown file, apply a single frontmatter field patch, and write it
 * back atomically (same-process, same-thread write — not multi-process safe).
 *
 * @param filepath  Absolute path to the markdown file.
 * @param field     Frontmatter field name (e.g. `'Fix_Version'`, `'Sprint'`).
 * @param value     New value for the field.
 */
export async function applyDocPatch(filepath: string, field: string, value: string): Promise<void> {
  const content = await fs.promises.readFile(filepath, 'utf-8');
  const patched = setFrontmatterField(content, field, value);
  await fs.promises.writeFile(filepath, patched);
}
