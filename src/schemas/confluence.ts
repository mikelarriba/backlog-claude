import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

// Epic-mode context (#556): alongside the flat `jiraIds` (which, in epic
// mode, carry the selected epic keys), the frontend can send each epic's
// closed child keys so /analyze can fetch and reason over the epic *and*
// what actually shipped under it, not just the epic's own summary.
// `epics` is optional and back-compat: when absent/empty, the route behaves
// exactly as it did before this field existed (the search-mode/jiraIds-only
// path).
const ConfluenceAnalyzeEpicSchema = z
  .object({
    key: z.string().min(1).openapi({ description: 'Epic JIRA key' }),
    summary: z.string().optional().openapi({ description: 'Epic summary' }),
    closedChildKeys: z
      .array(z.string().min(1))
      .optional()
      .openapi({ description: "Keys of the epic's closed child issues" }),
  })
  .openapi('ConfluenceAnalyzeEpic');

export const ConfluenceAnalyzeSchema = z
  .object({
    jiraIds: z
      .array(z.string().min(1))
      .min(1)
      .openapi({ description: 'JIRA issue keys to analyze' }),
    epics: z
      .array(ConfluenceAnalyzeEpicSchema)
      .optional()
      .openapi({ description: 'Epics with closed child keys, for epic-mode analysis' }),
  })
  .openapi('ConfluenceAnalyze');

const ConfluenceSuggestionSchema = z
  .object({
    pageTitle: z.string().min(1).openapi({ description: 'Confluence page title' }),
    hierarchyPath: z.string().optional().openapi({ description: 'Page hierarchy path' }),
    action: z.enum(['Create', 'Update', 'Delete']).openapi({ description: 'Action to apply' }),
    currentContent: z.string().optional().openapi({ description: 'Current page content' }),
    proposedContent: z.string().optional().openapi({ description: 'Proposed page content' }),
  })
  .openapi('ConfluenceSuggestion');

export const ConfluenceExecuteSchema = z
  .object({
    suggestions: z
      .array(ConfluenceSuggestionSchema)
      .min(1)
      .openapi({ description: 'Suggestions to apply' }),
  })
  .openapi('ConfluenceExecute');

// #559: PDF export of the proposed changes shown in the diff-review UI, ahead
// of (and independent from) actually applying anything via /execute above.
// `suggestions` reuses ConfluenceSuggestionSchema's exact shape but — unlike
// /execute — has no `.min(1)`: exporting the current (possibly empty) report
// is a meaningful edge case (e.g. the AI returned zero suggestions) that
// should still produce a valid, if sparse, PDF rather than a 400.
export const ConfluenceExportSchema = z
  .object({
    suggestions: z
      .array(ConfluenceSuggestionSchema)
      .openapi({ description: 'Suggestions to render in the PDF' }),
    scope: z
      .string()
      .optional()
      .openapi({ description: 'Human-readable scope label (e.g. sprint or fix version name)' }),
  })
  .openapi('ConfluenceExport');
