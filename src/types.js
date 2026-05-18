// ── Shared JSDoc type definitions ─────────────────────────────────────────────
// Import these in other files with:  /** @import { DocEntry } from './types.js' */
// (JSDoc-only file — no runtime exports needed)

/**
 * A single document entry in the in-memory doc index.
 * Built by docIndex._buildEntry(); read by routes and distribution logic.
 *
 * @typedef {Object} DocEntry
 * @property {string}      filename        - e.g. "2026-01-15-auth-epic.md"
 * @property {string}      docType         - "feature" | "epic" | "story" | "spike" | "bug"
 * @property {string}      title           - Extracted from the first ## or # heading
 * @property {string}      date            - ISO date prefix from filename, e.g. "2026-01-15"
 * @property {string}      status          - "Draft" | "Created in JIRA" | "Archived"
 * @property {string|null} fixVersion      - e.g. "PI-2026.1" or null if TBD
 * @property {string|null} jiraId          - e.g. "MIDAS-123" or null if TBD
 * @property {string|null} jiraUrl         - Full JIRA browse URL or null
 * @property {number|null} storyPoints     - Numeric story points or null if unestimated
 * @property {string|null} sprint          - Sprint name/number or null if unset
 * @property {number|null} rank            - Numeric sort rank or null
 * @property {string}      priority        - "High" | "Medium" | "Low" (default "Medium")
 * @property {string|null} parentFilename  - Filename of the parent epic/feature or null
 * @property {string|null} parentType      - "feature" | "epic" or null
 * @property {string[]}    blocks          - Filenames this doc blocks (deps it gates)
 * @property {string[]}    blockedBy       - Filenames that block this doc
 * @property {string|null} team            - Squad/team name or null if unset
 * @property {string|null} workCategory    - Work category label or null if unset
 * @property {boolean}     hasDescription  - true when body content > 30 chars
 */

/**
 * Sprint slot used by the distribution algorithm.
 *
 * @typedef {Object} SprintSlot
 * @property {string} name       - Sprint identifier, e.g. "Sprint 1"
 * @property {number} capacity   - Total story-point capacity for this sprint
 * @property {number} used       - Points already allocated (mutated during greedy fill)
 */

/**
 * A raw JIRA issue as returned by the JIRA REST API v2 `/issue` or `/search` endpoints.
 *
 * @typedef {Object} JiraIssue
 * @property {string} key    - e.g. "MIDAS-123"
 * @property {Object} fields
 * @property {string}                   fields.summary
 * @property {string|null}              fields.description    - JIRA wiki markup
 * @property {{ name: string }}         fields.issuetype
 * @property {{ name: string }}         fields.priority
 * @property {Array<{ name: string }>}  fields.fixVersions
 * @property {number|null}              [fields.story_points] - custom field, key varies by instance
 */

/**
 * A processed attachment ready for JIRA upload or pass-through.
 *
 * @typedef {Object} ProcessedAttachment
 * @property {string} filename - Final filename (may differ from original, e.g. .msg → .pdf)
 * @property {Buffer} buffer   - File content as a Node.js Buffer
 */

/**
 * A text or image segment produced by the HTML/plain-text email parser.
 *
 * @typedef {Object} EmailSegment
 * @property {'text'|'image'} type
 * @property {string}  [value]  - Present when type === 'text'
 * @property {Buffer}  [buffer] - Present when type === 'image'
 */

export {};
