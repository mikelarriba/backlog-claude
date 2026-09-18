// ── JIRA comment flatten/filter logic (pure) ──────────────────────────────────
// No I/O. Takes the issues returned by a paged JQL search (with the `comment`
// field expanded) and produces a flat, date/mention-filtered, newest-first list
// of comments for the Comments inbox view. Kept pure so it can be unit-tested
// without hitting JIRA.

export interface RawJiraComment {
  id?: string;
  author?: { name?: string; displayName?: string };
  body?: string;
  created?: string;
  updated?: string;
}

export interface RawCommentIssue {
  key: string;
  fields?: {
    summary?: string;
    comment?: { comments?: RawJiraComment[] };
  };
}

export interface FlatComment {
  issueKey: string;
  issueSummary: string;
  commentId: string;
  author: string; // display name (falls back to username)
  authorName: string; // username
  created: string;
  updated: string;
  body: string; // possibly transformed for display
  mentionsMe: boolean;
}

export interface FlattenCommentsOptions {
  from?: string; // YYYY-MM-DD, inclusive
  to?: string; // YYYY-MM-DD, inclusive
  mentionedOnly?: boolean; // keep only comments that @-mention the current user
  notRepliedByMe?: boolean; // exclude comments authored by the current user
  myName?: string; // JIRA username, for [~name] mention detection and author match
  transformBody?: (raw: string) => string; // display transform; identity by default
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Flattens comments across issues, filtering each comment by its own `created`
 * date (an issue may be recently updated yet carry old comments) and, when
 * requested, keeping only comments that @-mention the current user. Mentions are
 * detected on the RAW body (`[~username]`, case-insensitive) before any display
 * transform is applied. Returns newest-first.
 */
export function flattenAndFilterComments(
  issues: RawCommentIssue[],
  opts: FlattenCommentsOptions = {}
): FlatComment[] {
  const { from, to, mentionedOnly = false, notRepliedByMe = false, myName, transformBody } = opts;
  const mentionRe = myName ? new RegExp(`\\[~${escapeRegex(myName)}\\]`, 'i') : null;
  const myNameLc = (myName || '').toLowerCase();

  const out: FlatComment[] = [];
  for (const issue of issues) {
    const issueKey = issue.key;
    const issueSummary = String(issue.fields?.summary || '');
    const comments = issue.fields?.comment?.comments || [];

    // "Not replied by me" is an issue-level gate: if the issue's *latest*
    // comment is mine, I've already answered, so drop the whole issue — not
    // just my own comments. JIRA returns comments oldest-first, so the last
    // element is the newest. Without a known user we can't tell, so keep all.
    if (notRepliedByMe && myNameLc) {
      const last = comments[comments.length - 1];
      if (last && (last.author?.name || '').toLowerCase() === myNameLc) continue;
    }

    for (const c of comments) {
      const created = c.created || '';
      const day = created.slice(0, 10);
      // Date-string comparison is safe for ISO YYYY-MM-DD prefixes.
      if (from && day && day < from) continue;
      if (to && day && day > to) continue;

      const rawBody = c.body || '';
      const mentionsMe = mentionRe ? mentionRe.test(rawBody) : false;
      if (mentionedOnly && !mentionsMe) continue;

      // Within a kept issue, still hide my own comments — the actionable items
      // are the others' comments awaiting my reply.
      if (notRepliedByMe && myNameLc && (c.author?.name || '').toLowerCase() === myNameLc) continue;

      out.push({
        issueKey,
        issueSummary,
        commentId: String(c.id || ''),
        author: c.author?.displayName || c.author?.name || 'Unknown',
        authorName: c.author?.name || '',
        created,
        updated: c.updated || created,
        body: transformBody ? transformBody(rawBody) : rawBody,
        mentionsMe,
      });
    }
  }

  out.sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : 0));
  return out;
}
