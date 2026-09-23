// ── JIRA Comments inbox view ──────────────────────────────────────────────────
// Surfaces recent JIRA comments across the MIDAS project, filterable by date
// and by "mentions me", and lets the user reply with an optional AI polish step
// (draft → Improve → editable preview → Post) before posting back to JIRA.
// Replies are plain new comments on the issue (JIRA comments aren't threaded).
import {
  fetchJSON,
  postJSON,
  escHtml,
  renderMarkdown,
  showJiraToast,
  openModal,
  closeModal,
} from './state.js';
import { registerActions } from './actions.js';

interface CommentItem {
  issueKey: string;
  issueSummary: string;
  commentId: string;
  author: string;
  authorName: string;
  created: string;
  updated: string;
  body: string; // markdown
  mentionsMe: boolean;
}

// ── Module state ──────────────────────────────────────────────────────────────
// Date preset is mutually exclusive ('' = no lower bound beyond the server's
// 2-month cap). "Not replied by me" and "Mentions me" are independent toggles
// that stack (AND) with each other and the date preset.
type DateRange = '' | 'today' | 'week';
let _dateRange: DateRange = '';
let _mentionedOnly = false;
let _notRepliedByMe = false;
let _jiraBase = '';
let _lastComments: CommentItem[] = [];
let _replyKey = '';

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// Maps the active date preset to a `from` bound. '' → undefined so the server
// applies its default 2-month floor.
function rangeFrom(): string | undefined {
  if (_dateRange === 'today') return isoDaysAgo(0);
  if (_dateRange === 'week') return isoDaysAgo(7);
  return undefined;
}

function syncFilterButtons(): void {
  document.querySelectorAll<HTMLElement>('#comments-view .comments-filter-btn').forEach((el) => {
    const action = el.dataset.action;
    if (action === 'commentsToggleRange') {
      el.classList.toggle('active', el.dataset.value === _dateRange && _dateRange !== '');
    } else if (action === 'commentsToggleNotReplied') {
      el.classList.toggle('active', _notRepliedByMe);
    } else if (action === 'commentsToggleMention') {
      el.classList.toggle('active', _mentionedOnly);
    }
  });
}

export async function loadCommentsView(): Promise<void> {
  syncFilterButtons();
  await reloadComments();
}

async function reloadComments(): Promise<void> {
  const list = document.getElementById('comments-list');
  if (!list) return;
  list.innerHTML = '<div class="comments-loading">Loading comments…</div>';

  const params = new URLSearchParams();
  const from = rangeFrom();
  if (from) params.set('from', from);
  if (_mentionedOnly) params.set('mentionedOnly', 'true');
  if (_notRepliedByMe) params.set('notRepliedByMe', 'true');

  try {
    const data = (await fetchJSON(`/api/jira/comments?${params.toString()}`)) as {
      comments: CommentItem[];
      jiraBase: string;
    };
    _jiraBase = data.jiraBase || '';
    _lastComments = data.comments || [];
    renderComments(_lastComments);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load comments';
    list.innerHTML = `<div class="comments-empty">${escHtml(msg)}</div>`;
  }
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace('T', ' ');
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderComments(comments: CommentItem[]): void {
  const list = document.getElementById('comments-list');
  if (!list) return;
  if (comments.length === 0) {
    list.innerHTML = '<div class="comments-empty">No comments match the selected filters.</div>';
    return;
  }

  list.innerHTML = comments
    .map((c) => {
      const url = _jiraBase ? `${_jiraBase}/browse/${encodeURIComponent(c.issueKey)}` : '#';
      const badge = c.mentionsMe ? '<span class="comment-mention-badge">Mentions you</span>' : '';
      // Cards start collapsed: only a one-line preview shows. Clicking the
      // preview (or the expanded body) toggles the full rendered comment.
      const preview = c.body.replace(/\s+/g, ' ').trim();
      return `
      <div class="comment-card collapsed${c.mentionsMe ? ' mentions-me' : ''}" data-comment-id="${escHtml(c.commentId)}">
        <div class="comment-card-head">
          <a class="comment-issue-key" href="${escHtml(url)}" target="_blank" rel="noopener">${escHtml(c.issueKey)}</a>
          <span class="comment-issue-summary">${escHtml(c.issueSummary)}</span>
          ${badge}
        </div>
        <div class="comment-meta">
          <span class="comment-author">${escHtml(c.author)}</span>
          <span class="comment-date">${escHtml(formatDate(c.created))}</span>
        </div>
        <div class="comment-preview" data-action="toggleCommentExpand" data-comment-id="${escHtml(c.commentId)}" title="Click to expand">${escHtml(preview)}</div>
        <div class="comment-body" data-action="toggleCommentExpand" data-comment-id="${escHtml(c.commentId)}">${renderMarkdown(c.body)}</div>
        <div class="comment-card-actions">
          <button class="btn-secondary btn-xs" data-action="openCommentReply" data-comment-id="${escHtml(c.commentId)}" data-issue-key="${escHtml(c.issueKey)}">Reply</button>
        </div>
      </div>`;
    })
    .join('');
}

// ── Filters ───────────────────────────────────────────────────────────────────
// Date presets are mutually exclusive: clicking the active one clears it (→ no
// lower bound beyond the 2-month cap), clicking the other switches to it.
function commentsToggleRange(value: string): void {
  const v = value as DateRange;
  _dateRange = _dateRange === v ? '' : v;
  syncFilterButtons();
  void reloadComments();
}

function commentsToggleNotReplied(): void {
  _notRepliedByMe = !_notRepliedByMe;
  syncFilterButtons();
  void reloadComments();
}

function commentsToggleMention(): void {
  _mentionedOnly = !_mentionedOnly;
  syncFilterButtons();
  void reloadComments();
}

// ── Expand / collapse a comment card ────────────────────────────────────────────
function toggleCommentExpand(commentId: string): void {
  const card = document.querySelector<HTMLElement>(
    `.comment-card[data-comment-id="${CSS.escape(commentId)}"]`
  );
  card?.classList.toggle('collapsed');
}

// ── Reply flow ─────────────────────────────────────────────────────────────────
function openCommentReply(commentId: string, issueKey: string): void {
  const source = _lastComments.find((c) => c.commentId === commentId);
  _replyKey = issueKey;

  const keyEl = document.getElementById('comment-reply-key');
  if (keyEl) keyEl.textContent = issueKey;

  const ctx = document.getElementById('comment-reply-context');
  if (ctx) {
    ctx.innerHTML = source
      ? `<strong>${escHtml(source.author)}</strong> wrote:<br>${renderMarkdown(source.body)}`
      : '';
  }

  const textarea = document.getElementById('comment-reply-text') as HTMLTextAreaElement | null;
  if (textarea) textarea.value = '';
  setReplyStatus('');
  openModal('comment-reply-modal');
  textarea?.focus();
}

function closeCommentReply(): void {
  closeModal('comment-reply-modal');
  _replyKey = '';
}

function setReplyStatus(msg: string): void {
  const el = document.getElementById('comment-reply-status');
  if (el) el.textContent = msg;
}

async function improveCommentReply(): Promise<void> {
  const textarea = document.getElementById('comment-reply-text') as HTMLTextAreaElement | null;
  const btn = document.getElementById('comment-improve-btn') as HTMLButtonElement | null;
  if (!textarea) return;
  const text = textarea.value.trim();
  if (!text) {
    setReplyStatus('Write a draft first, then Improve.');
    return;
  }
  if (btn) btn.disabled = true;
  setReplyStatus('Improving…');
  try {
    const data = (await postJSON('/api/jira/comments/improve', { text })) as { improved: string };
    textarea.value = data.improved || text;
    setReplyStatus('Improved — review and edit before posting.');
  } catch (err) {
    setReplyStatus(err instanceof Error ? err.message : 'Improve failed');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function postCommentReply(): Promise<void> {
  const textarea = document.getElementById('comment-reply-text') as HTMLTextAreaElement | null;
  const btn = document.getElementById('comment-post-btn') as HTMLButtonElement | null;
  if (!textarea || !_replyKey) return;
  const text = textarea.value.trim();
  if (!text) {
    setReplyStatus('Nothing to post.');
    return;
  }
  if (btn) btn.disabled = true;
  setReplyStatus('Posting…');
  try {
    await postJSON(`/api/jira/comments/${encodeURIComponent(_replyKey)}`, { text });
    showJiraToast('success', `Comment posted to ${_replyKey}`);
    closeCommentReply();
    await reloadComments();
  } catch (err) {
    setReplyStatus(err instanceof Error ? err.message : 'Post failed');
  } finally {
    if (btn) btn.disabled = false;
  }
}

registerActions({
  commentsToggleRange: (el) => commentsToggleRange(el.dataset.value ?? ''),
  commentsToggleNotReplied: () => commentsToggleNotReplied(),
  commentsToggleMention: () => commentsToggleMention(),
  toggleCommentExpand: (el) => toggleCommentExpand(el.dataset.commentId ?? ''),
  openCommentReply: (el) => openCommentReply(el.dataset.commentId ?? '', el.dataset.issueKey ?? ''),
  closeCommentReply: () => closeCommentReply(),
  improveCommentReply: () => void improveCommentReply(),
  postCommentReply: () => void postCommentReply(),
});
