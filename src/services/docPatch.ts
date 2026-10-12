// ── Document patch helper ──────────────────────────────────────────────────────
// Encapsulates the read → frontmatter-patch → write sequence that is repeated
// in every batch-mutation route.  Callers are responsible for index invalidation
// and broadcasting SSE events because the strategy differs per endpoint
// (per-item `invalidate` vs. a single `invalidateAll` after the batch).
import { setFrontmatterField } from '../utils/transforms.js';
import { updateDoc } from '../utils/fileWrite.js';

/**
 * Read a markdown file, apply a single frontmatter field patch, and write it
 * back atomically (same-process, same-thread write — not multi-process safe).
 *
 * @param filepath  Absolute path to the markdown file.
 * @param field     Frontmatter field name (e.g. `'Fix_Version'`, `'Sprint'`).
 * @param value     New value for the field.
 */
export async function applyDocPatch(filepath: string, field: string, value: string): Promise<void> {
  await updateDoc(filepath, (content) => setFrontmatterField(content, field, value));
}
