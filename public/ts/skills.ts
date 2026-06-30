// ── Skills view: command template editor ─────────────────────────────────────
import { fetchJSON, putJSON, deleteJSON, escHtml } from './state.js';

const DOC_COMMANDS = [
  'create-features',
  'create-epics',
  'create-stories',
  'create-spikes',
  'create-bugs',
];
const UTILITY_COMMANDS = ['refine-epics', 'backlog-analysis-agent'];

interface ProductContext {
  content: string;
  source: string;
}

interface Skill {
  name: string;
  description: string;
  content: string;
  source: string;
}

interface SkillsResponse {
  skills?: Skill[];
}

export interface SkillSSEPayload {
  type?: string;
  name?: string;
}

let _skillsCache: Skill[] = [];

// ── Product Context ──────────────────────────────────────────────────────────
function renderProductContext(ctx: ProductContext): string {
  const badgeClass = ctx.source === 'custom' ? 'custom' : 'template';
  const badgeLabel = ctx.source === 'custom' ? 'Custom' : 'Template';
  const showReset = ctx.source === 'custom';

  return `
    <div class="skill-card product-context-card" data-skill="product-context">
      <div class="skill-header" onclick="toggleSkillCard('product-context')">
        <span class="skill-chevron" id="skill-chev-product-context">▶</span>
        <span class="skill-name">Product Context</span>
        <span class="skill-badge ${badgeClass}" id="skill-badge-product-context">${badgeLabel}</span>
      </div>
      <div class="skill-body" id="skill-body-product-context">
        <div class="skill-inner">
          <div class="skill-desc">Shared product details injected into all commands via <code>{{PRODUCT_CONTEXT}}</code>. Configure once — all skills benefit.</div>
          <textarea
            class="skill-textarea"
            id="skill-ta-product-context"
            spellcheck="false"
          >${escHtml(ctx.content)}</textarea>
          <div class="skill-actions">
            <button class="btn-skill-save" onclick="saveProductContext()">Save</button>
            ${showReset ? '<button class="btn-skill-reset" onclick="resetProductContext()">Reset to Template</button>' : ''}
            <span class="skill-status" id="skill-status-product-context"></span>
          </div>
        </div>
      </div>
    </div>`;
}

export async function saveProductContext(): Promise<void> {
  const ta = document.getElementById('skill-ta-product-context') as HTMLTextAreaElement | null;
  if (!ta) return;
  const content = ta.value;
  if (!content.trim()) {
    setSkillStatus('product-context', 'error', 'Content cannot be empty.');
    return;
  }

  const btn = ta
    .closest('.skill-inner')
    ?.querySelector('.btn-skill-save') as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving…';
  }

  try {
    await putJSON('/api/settings/product-context', { content });
    setSkillStatus('product-context', 'success', 'Saved.');
    updateSkillBadge('product-context', 'custom');
    // Ensure reset button is shown
    const actions = ta.closest('.skill-inner')?.querySelector('.skill-actions');
    if (actions && !actions.querySelector('.btn-skill-reset')) {
      const resetBtn = document.createElement('button');
      resetBtn.className = 'btn-skill-reset';
      resetBtn.textContent = 'Reset to Template';
      resetBtn.onclick = () => resetProductContext();
      actions.insertBefore(resetBtn, actions.querySelector('.skill-status'));
    }
  } catch (e) {
    setSkillStatus('product-context', 'error', (e as Error).message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  }
}

export async function resetProductContext(): Promise<void> {
  try {
    const data = (await deleteJSON(
      '/api/settings/product-context'
    )) as Partial<ProductContext> | null;
    const ta = document.getElementById('skill-ta-product-context') as HTMLTextAreaElement | null;
    if (ta && data?.content) ta.value = data.content;
    updateSkillBadge('product-context', 'example');
    setSkillStatus('product-context', 'success', 'Reset to template.');
    const card = document.querySelector('.product-context-card');
    const resetBtn = card?.querySelector('.btn-skill-reset');
    if (resetBtn) resetBtn.remove();
  } catch (e) {
    setSkillStatus('product-context', 'error', (e as Error).message);
  }
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderSkillCard(skill: Skill): string {
  const badgeClass = skill.source === 'custom' ? 'custom' : 'template';
  const badgeLabel = skill.source === 'custom' ? 'Custom' : 'Template';
  const showReset = skill.source === 'custom';
  const displayName = skill.name
    .replace(/^create-/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return `
    <div class="skill-card" data-skill="${escHtml(skill.name)}">
      <div class="skill-header" onclick="toggleSkillCard('${escHtml(skill.name)}')">
        <span class="skill-chevron" id="skill-chev-${escHtml(skill.name)}">▶</span>
        <span class="skill-name">${escHtml(displayName)}</span>
        <span class="skill-badge ${badgeClass}" id="skill-badge-${escHtml(skill.name)}">${badgeLabel}</span>
      </div>
      <div class="skill-body" id="skill-body-${escHtml(skill.name)}">
        <div class="skill-inner">
          <div class="skill-desc">${escHtml(skill.description)}</div>
          <textarea
            class="skill-textarea"
            id="skill-ta-${escHtml(skill.name)}"
            spellcheck="false"
          >${escHtml(skill.content)}</textarea>
          <div class="skill-actions">
            <button class="btn-skill-save" onclick="saveSkill('${escHtml(skill.name)}')">Save</button>
            <button class="btn-skill-improve" onclick="improveSkill('${escHtml(skill.name)}')">AI Improve</button>
            ${showReset ? `<button class="btn-skill-reset" onclick="resetSkill('${escHtml(skill.name)}')">Reset to Template</button>` : ''}
            <span class="skill-status" id="skill-status-${escHtml(skill.name)}"></span>
          </div>
        </div>
      </div>
    </div>`;
}

export async function loadSkillsView(): Promise<void> {
  const container = document.getElementById('skills-body');
  if (!container) return;

  let ctxHtml = '';
  try {
    const ctx = (await fetchJSON('/api/settings/product-context')) as ProductContext;
    ctxHtml = renderProductContext(ctx);
  } catch {
    /* product context is optional */
  }

  try {
    const data = (await fetchJSON('/api/skills')) as SkillsResponse;
    _skillsCache = data.skills || [];
  } catch (e) {
    container.innerHTML = `<p style="color:var(--error-text)">Failed to load skills: ${escHtml((e as Error).message)}</p>`;
    return;
  }

  const docSkills = _skillsCache.filter((s) => DOC_COMMANDS.includes(s.name));
  const utilSkills = _skillsCache.filter((s) => UTILITY_COMMANDS.includes(s.name));

  container.innerHTML =
    '<div class="skills-section-label">Product Context</div>' +
    ctxHtml +
    '<div class="skills-section-label">Document Commands</div>' +
    docSkills.map(renderSkillCard).join('') +
    '<div class="skills-section-label">Utility Commands</div>' +
    utilSkills.map(renderSkillCard).join('');
}

// ── Toggle ────────────────────────────────────────────────────────────────────
export function toggleSkillCard(name: string): void {
  const body = document.getElementById(`skill-body-${name}`);
  const chevron = document.getElementById(`skill-chev-${name}`) as HTMLElement | null;
  if (!body || !chevron) return;
  const isOpen = body.classList.toggle('open');
  chevron.style.transform = isOpen ? 'rotate(90deg)' : '';
}

// ── Save ──────────────────────────────────────────────────────────────────────
export async function saveSkill(name: string): Promise<void> {
  const ta = document.getElementById(`skill-ta-${name}`) as HTMLTextAreaElement | null;
  if (!ta) return;
  const content = ta.value;
  if (!content.trim()) {
    setSkillStatus(name, 'error', 'Content cannot be empty.');
    return;
  }

  const btn = ta
    .closest('.skill-inner')
    ?.querySelector('.btn-skill-save') as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving…';
  }

  try {
    await putJSON(`/api/skills/${encodeURIComponent(name)}`, { content });
    setSkillStatus(name, 'success', 'Saved.');
    updateSkillBadge(name, 'custom');
    // Ensure reset button is shown
    const actions = ta.closest('.skill-inner')?.querySelector('.skill-actions');
    if (actions && !actions.querySelector('.btn-skill-reset')) {
      const resetBtn = document.createElement('button');
      resetBtn.className = 'btn-skill-reset';
      resetBtn.textContent = 'Reset to Template';
      resetBtn.onclick = () => resetSkill(name);
      actions.insertBefore(resetBtn, actions.querySelector('.skill-status'));
    }
  } catch (e) {
    setSkillStatus(name, 'error', (e as Error).message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  }
}

// ── Reset ─────────────────────────────────────────────────────────────────────
export async function resetSkill(name: string): Promise<void> {
  try {
    const data = (await deleteJSON(
      `/api/skills/${encodeURIComponent(name)}`
    )) as Partial<Skill> | null;
    const ta = document.getElementById(`skill-ta-${name}`) as HTMLTextAreaElement | null;
    if (ta && data?.content) ta.value = data.content;
    updateSkillBadge(name, 'example');
    setSkillStatus(name, 'success', 'Reset to template.');
    // Remove reset button
    const card = document.querySelector(`.skill-card[data-skill="${name}"]`);
    const resetBtn = card?.querySelector('.btn-skill-reset');
    if (resetBtn) resetBtn.remove();
  } catch (e) {
    setSkillStatus(name, 'error', (e as Error).message);
  }
}

// ── AI Improve ───────────────────────────────────────────────────────────────
export async function improveSkill(name: string): Promise<void> {
  const ta = document.getElementById(`skill-ta-${name}`) as HTMLTextAreaElement | null;
  if (!ta) return;
  const content = ta.value;
  if (!content.trim()) {
    setSkillStatus(name, 'error', 'Content cannot be empty.');
    return;
  }

  const btn = ta
    .closest('.skill-inner')
    ?.querySelector('.btn-skill-improve') as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Improving…';
  }

  try {
    const data = (await putJSON(`/api/skills/${encodeURIComponent(name)}/improve`, {
      content,
    })) as {
      improved: string;
    };
    ta.value = data.improved;
    setSkillStatus(name, 'success', 'AI suggestion applied. Review and Save when ready.');
  } catch (e) {
    setSkillStatus(name, 'error', (e as Error).message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'AI Improve';
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function updateSkillBadge(name: string, source: string): void {
  const badge = document.getElementById(`skill-badge-${name}`);
  if (!badge) return;
  badge.className = `skill-badge ${source === 'custom' ? 'custom' : 'template'}`;
  badge.textContent = source === 'custom' ? 'Custom' : 'Template';
}

function setSkillStatus(name: string, type: string, message?: string): void {
  const el = document.getElementById(`skill-status-${name}`) as HTMLElement | null;
  if (!el) return;
  el.className = `skill-status${type !== 'hidden' ? ' show ' + type : ''}`;
  el.textContent = message || '';
  if (type === 'success') {
    setTimeout(() => {
      el.className = 'skill-status';
    }, 3000);
  }
}

// ── SSE handler ───────────────────────────────────────────────────────────────
export function handleSkillSSE(payload: SkillSSEPayload): void {
  if (payload.type === 'skill_updated' || payload.type === 'skill_reset') {
    const name = payload.name;
    if (!name) return;
    fetchJSON(`/api/skills/${encodeURIComponent(name)}`)
      .then((skill) => {
        const s = skill as Skill;
        const ta = document.getElementById(`skill-ta-${name}`) as HTMLTextAreaElement | null;
        if (ta) ta.value = s.content;
        updateSkillBadge(name, s.source);
      })
      .catch(() => {
        /* SSE refresh is best-effort */
      });
  }
  if (payload.type === 'product_context_updated' || payload.type === 'product_context_reset') {
    fetchJSON('/api/settings/product-context')
      .then((ctx) => {
        const c = ctx as ProductContext;
        const ta = document.getElementById(
          'skill-ta-product-context'
        ) as HTMLTextAreaElement | null;
        if (ta) ta.value = c.content;
        updateSkillBadge('product-context', c.source);
      })
      .catch(() => {
        /* best-effort */
      });
  }
}
