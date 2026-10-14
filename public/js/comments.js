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
import { registerActions, registerInputActions } from './actions.js';
let _dateRange = '';
let _mentionedOnly = false;
let _notRepliedByMe = false;
let _issueKeyFilter = '';
let _jiraBase = '';
let _lastComments = [];
let _replyKey = '';
let _issueKeyDebounce;
function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
// Maps the active date preset to a `from` bound. '' → undefined so the server
// applies its default 2-month floor.
function rangeFrom() {
  if (_dateRange === 'today') return isoDaysAgo(0);
  if (_dateRange === 'week') return isoDaysAgo(7);
  return undefined;
}
function syncFilterButtons() {
  document.querySelectorAll('#comments-view .comments-filter-btn').forEach((el) => {
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
export async function loadCommentsView() {
  syncFilterButtons();
  await reloadComments();
}
async function reloadComments() {
  const list = document.getElementById('comments-list');
  if (!list) return;
  list.innerHTML = '<div class="comments-loading">Loading comments…</div>';
  const params = new URLSearchParams();
  const from = rangeFrom();
  if (from) params.set('from', from);
  if (_mentionedOnly) params.set('mentionedOnly', 'true');
  if (_notRepliedByMe) params.set('notRepliedByMe', 'true');
  if (_issueKeyFilter) params.set('issueKey', _issueKeyFilter);
  try {
    const data = await fetchJSON(`/api/jira/comments?${params.toString()}`);
    _jiraBase = data.jiraBase || '';
    _lastComments = data.comments || [];
    renderComments(_lastComments);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load comments';
    list.innerHTML = `<div class="comments-empty">${escHtml(msg)}</div>`;
  }
}
function formatDate(iso) {
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
function renderComments(comments) {
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
function commentsToggleRange(value) {
  const v = value;
  _dateRange = _dateRange === v ? '' : v;
  syncFilterButtons();
  void reloadComments();
}
function commentsToggleNotReplied() {
  _notRepliedByMe = !_notRepliedByMe;
  syncFilterButtons();
  void reloadComments();
}
function commentsToggleMention() {
  _mentionedOnly = !_mentionedOnly;
  syncFilterButtons();
  void reloadComments();
}
// ── Ticket-id filter ────────────────────────────────────────────────────────────
// Debounced so a reload only fires once the user pauses typing. Accepts a bare
// number (resolved to a project key server-side) or a full key; the server
// bypasses the date floor when a ticket filter is active.
function commentsSetIssueKey(value) {
  const next = value.trim();
  if (next === _issueKeyFilter) return;
  _issueKeyFilter = next;
  if (_issueKeyDebounce) clearTimeout(_issueKeyDebounce);
  _issueKeyDebounce = setTimeout(() => void reloadComments(), 350);
}
function commentsClearIssueKey() {
  if (_issueKeyDebounce) clearTimeout(_issueKeyDebounce);
  _issueKeyFilter = '';
  const input = document.getElementById('comments-ticket-input');
  if (input) input.value = '';
  void reloadComments();
}
// ── Expand / collapse a comment card ────────────────────────────────────────────
function toggleCommentExpand(commentId) {
  const card = document.querySelector(`.comment-card[data-comment-id="${CSS.escape(commentId)}"]`);
  card?.classList.toggle('collapsed');
}
// ── Reply flow ─────────────────────────────────────────────────────────────────
function openCommentReply(commentId, issueKey) {
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
  const textarea = document.getElementById('comment-reply-text');
  if (textarea) textarea.value = '';
  setReplyStatus('');
  openModal('comment-reply-modal');
  ensureMentionAutocomplete();
  textarea?.focus();
}
function closeCommentReply() {
  hideMentionMenu();
  closeModal('comment-reply-modal');
  _replyKey = '';
}
function setReplyStatus(msg) {
  const el = document.getElementById('comment-reply-status');
  if (el) el.textContent = msg;
}
async function improveCommentReply() {
  const textarea = document.getElementById('comment-reply-text');
  const btn = document.getElementById('comment-improve-btn');
  if (!textarea) return;
  const text = textarea.value.trim();
  if (!text) {
    setReplyStatus('Write a draft first, then Improve.');
    return;
  }
  if (btn) btn.disabled = true;
  setReplyStatus('Improving…');
  try {
    const data = await postJSON('/api/jira/comments/improve', { text });
    textarea.value = data.improved || text;
    setReplyStatus('Improved — review and edit before posting.');
  } catch (err) {
    setReplyStatus(err instanceof Error ? err.message : 'Improve failed');
  } finally {
    if (btn) btn.disabled = false;
  }
}
async function postCommentReply() {
  const textarea = document.getElementById('comment-reply-text');
  const btn = document.getElementById('comment-post-btn');
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
// ── @-mention autocomplete ──────────────────────────────────────────────────────
// A lightweight typeahead over the reply textarea: typing "@foo" queries JIRA
// for matching users and, on selection, inserts the JIRA Server mention token
// `[~username]` (the same syntax flattenAndFilterComments detects on the way
// back in). Listeners are attached once, lazily, the first time the reply modal
// opens. Caret-anchoring is deliberately simple — the menu docks to the bottom
// of the textarea rather than tracking the exact caret pixel.
let _mentionWired = false;
let _mentionUsers = [];
let _mentionIndex = 0;
let _mentionStart = -1; // index of the triggering '@' within the textarea value
let _mentionFetchSeq = 0; // guards against out-of-order responses
let _mentionDebounce;
function mentionMenuEl() {
  return document.getElementById('comment-mention-menu');
}
function hideMentionMenu() {
  const menu = mentionMenuEl();
  if (menu) {
    menu.hidden = true;
    menu.innerHTML = '';
  }
  _mentionUsers = [];
  _mentionStart = -1;
  _mentionIndex = 0;
}
// Finds an active "@query" token ending at the caret. Returns null when the
// caret isn't inside one (e.g. there's whitespace between '@' and the caret).
function detectMention(textarea) {
  const pos = textarea.selectionStart ?? 0;
  const upto = textarea.value.slice(0, pos);
  const m = /(?:^|\s)@([\w.-]*)$/.exec(upto);
  if (!m) return null;
  const query = m[1];
  return { start: pos - query.length - 1, query };
}
function renderMentionMenu() {
  const menu = mentionMenuEl();
  if (!menu) return;
  if (_mentionUsers.length === 0) {
    menu.hidden = true;
    menu.innerHTML = '';
    return;
  }
  menu.innerHTML = _mentionUsers
    .map((u, i) => {
      const sub = u.email || u.name;
      return `<div class="comment-mention-item${i === _mentionIndex ? ' active' : ''}" role="option" data-mention-index="${i}">
        <span class="comment-mention-name">${escHtml(u.displayName)}</span>
        <span class="comment-mention-sub">${escHtml(sub)}</span>
      </div>`;
    })
    .join('');
  menu.hidden = false;
}
async function fetchMentionUsers(query) {
  const seq = ++_mentionFetchSeq;
  try {
    const data = await fetchJSON(`/api/jira/users?query=${encodeURIComponent(query)}`);
    if (seq !== _mentionFetchSeq || _mentionStart < 0) return; // superseded or cancelled
    _mentionUsers = data.users || [];
    _mentionIndex = 0;
    renderMentionMenu();
  } catch {
    if (seq === _mentionFetchSeq) hideMentionMenu();
  }
}
function insertMention(user) {
  const textarea = document.getElementById('comment-reply-text');
  if (!textarea || _mentionStart < 0) return;
  const pos = textarea.selectionStart ?? textarea.value.length;
  const before = textarea.value.slice(0, _mentionStart);
  const after = textarea.value.slice(pos);
  const token = `[~${user.name}] `;
  textarea.value = before + token + after;
  const caret = before.length + token.length;
  textarea.setSelectionRange(caret, caret);
  hideMentionMenu();
  textarea.focus();
}
function onMentionInput(textarea) {
  const det = detectMention(textarea);
  if (!det) {
    hideMentionMenu();
    return;
  }
  _mentionStart = det.start;
  if (_mentionDebounce) clearTimeout(_mentionDebounce);
  if (det.query.length < 1) {
    // Just the bare "@" — wait for at least one character before querying.
    hideMentionMenu();
    _mentionStart = det.start; // keep anchor so the next keystroke resolves
    return;
  }
  _mentionDebounce = setTimeout(() => void fetchMentionUsers(det.query), 200);
}
function onMentionKeydown(e) {
  const menu = mentionMenuEl();
  if (!menu || menu.hidden || _mentionUsers.length === 0) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _mentionIndex = (_mentionIndex + 1) % _mentionUsers.length;
    renderMentionMenu();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _mentionIndex = (_mentionIndex - 1 + _mentionUsers.length) % _mentionUsers.length;
    renderMentionMenu();
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    const user = _mentionUsers[_mentionIndex];
    if (user) insertMention(user);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    hideMentionMenu();
  }
}
function ensureMentionAutocomplete() {
  if (_mentionWired) return;
  const textarea = document.getElementById('comment-reply-text');
  const menu = mentionMenuEl();
  if (!textarea || !menu) return;
  _mentionWired = true;
  textarea.addEventListener('input', () => onMentionInput(textarea));
  textarea.addEventListener('keydown', onMentionKeydown);
  textarea.addEventListener('blur', () => setTimeout(hideMentionMenu, 120));
  // mousedown (not click) so selection runs before the textarea loses focus.
  menu.addEventListener('mousedown', (e) => {
    const item = e.target.closest('.comment-mention-item');
    if (!item) return;
    e.preventDefault();
    const idx = Number(item.dataset.mentionIndex);
    const user = _mentionUsers[idx];
    if (user) insertMention(user);
  });
}
registerInputActions({
  commentsSetIssueKey: (el) => commentsSetIssueKey(el.value),
});
registerActions({
  commentsToggleRange: (el) => commentsToggleRange(el.dataset.value ?? ''),
  commentsToggleNotReplied: () => commentsToggleNotReplied(),
  commentsToggleMention: () => commentsToggleMention(),
  commentsClearIssueKey: () => commentsClearIssueKey(),
  toggleCommentExpand: (el) => toggleCommentExpand(el.dataset.commentId ?? ''),
  openCommentReply: (el) => openCommentReply(el.dataset.commentId ?? '', el.dataset.issueKey ?? ''),
  closeCommentReply: () => closeCommentReply(),
  improveCommentReply: () => void improveCommentReply(),
  postCommentReply: () => void postCommentReply(),
});
//# sourceMappingURL=comments.js.map
