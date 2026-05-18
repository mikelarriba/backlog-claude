// ── Document type registry ────────────────────────────────────────────────────
// Single source of truth for all document types in the system.
// Adding a new doc type requires a change only here.
import path from 'path';

/**
 * Build the TYPE_CONFIG map for a given docs root directory.
 * Each entry defines the Claude slash-command name, the directory (as a lazy
 * getter so tests can supply a temp root), and the SSE event name for creates.
 *
 * @param {string} docsRoot - Absolute path to the docs root directory
 * @returns {Record<string, { command: string, dir: () => string, event: string }>}
 */
export function createTypeConfig(docsRoot) {
  return {
    feature: { command: 'create-features', dir: () => path.join(docsRoot, 'features'), event: 'feature_created' },
    epic:    { command: 'create-epics',    dir: () => path.join(docsRoot, 'epics'),    event: 'epic_created'    },
    story:   { command: 'create-stories',  dir: () => path.join(docsRoot, 'stories'),  event: 'story_created'   },
    spike:   { command: 'create-spikes',   dir: () => path.join(docsRoot, 'spikes'),   event: 'spike_created'   },
    bug:     { command: 'create-bugs',     dir: () => path.join(docsRoot, 'bugs'),     event: 'bug_created'     },
  };
}
