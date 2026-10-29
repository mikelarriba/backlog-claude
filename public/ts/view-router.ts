// ── View router: sidebar navigation, settings chrome, FAB ────────
import { closeBugForm } from './bugcreate.js';
import { resetRefineViewState } from './refine.js';
import { renderPiConfigTabs } from './piconfig.js';
import { openRoadmapView } from './roadmap.js';
import { loadSkillsView } from './skills.js';
import { loadAiSavingsSection } from './ai-savings.js';
import { loadBugsDashboard } from './bugs-dashboard.js';
import { loadDocumentationView } from './documentation.js';
import { loadCommentsView } from './comments.js';

// ── Sidebar collapse toggle (Ctrl+B) ─────────────────────────
export function toggleLeftPanel(): void {
  const app = document.getElementById('app-root');
  if (!app) return;
  const collapsed = app.classList.toggle('left-collapsed');
  try {
    localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
  } catch {
    /* no-op */
  }
}

// ── Sidebar navigation ────────────────────────────────────────
export type ViewName =
  | 'backlog'
  | 'roadmap'
  | 'settings'
  | 'skills'
  | 'documentation'
  | 'bugs'
  | 'comments'
  | 'suggestions';

export function navigateTo(viewName: ViewName): void {
  // Update active state in sidebar
  document.querySelectorAll<HTMLElement>('.sidebar-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.view === viewName);
  });

  // Hide all views
  const lv = document.getElementById('list-view');
  if (lv) lv.style.display = 'none';
  document.getElementById('detail-view')?.classList.remove('show');
  resetRefineViewState();
  document.getElementById('roadmap-view')?.classList.remove('show');
  document.getElementById('settings-view')?.classList.remove('show');
  document.getElementById('skills-view')?.classList.remove('show');
  document.getElementById('documentation-view')?.classList.remove('show');
  document.getElementById('bugs-view')?.classList.remove('show');
  document.getElementById('comments-view')?.classList.remove('show');
  document.getElementById('suggestions-view')?.classList.remove('show');

  // Hide FAB when not in backlog
  const fabContainer = document.getElementById('fab-container');
  if (fabContainer) fabContainer.style.display = viewName === 'backlog' ? '' : 'none';

  // Clean up roadmap-mode when leaving roadmap
  const right = document.querySelector('.right');
  if (viewName !== 'roadmap') {
    right?.classList.remove('roadmap-mode');
    right?.classList.remove('has-selection');
  }

  // Show the requested view
  switch (viewName) {
    case 'backlog':
      if (lv) lv.style.display = '';
      break;
    case 'roadmap':
      openRoadmapView();
      break;
    case 'settings':
      document.getElementById('settings-view')?.classList.add('show');
      openAllSettingsPanels();
      renderPiConfigTabs();
      void loadAiSavingsSection();
      break;
    case 'skills':
      document.getElementById('skills-view')?.classList.add('show');
      loadSkillsView();
      break;
    case 'documentation':
      document.getElementById('documentation-view')?.classList.add('show');
      void loadDocumentationView();
      break;
    case 'bugs':
      document.getElementById('bugs-view')?.classList.add('show');
      loadBugsDashboard();
      break;
    case 'comments':
      document.getElementById('comments-view')?.classList.add('show');
      void loadCommentsView();
      break;
    case 'suggestions':
      document.getElementById('suggestions-view')?.classList.add('show');
      break;
  }
}

// ── Settings view ─────────────────────────────────────────────
export function closeSettingsView(): void {
  navigateTo('backlog');
}

// Settings collapsibles start expanded every time the view opens, so the user
// sees all configuration at a glance rather than three closed accordions.
function openAllSettingsPanels(): void {
  const panels: Array<[string, string]> = [
    ['model-section-body', 'model-chevron'],
    ['pi-config-body', 'pi-config-chevron'],
    ['ai-savings-section-body', 'ai-savings-chevron'],
  ];
  for (const [bodyId, chevronId] of panels) {
    const body = document.getElementById(bodyId);
    const chevron = document.getElementById(chevronId);
    if (body && !body.classList.contains('open')) {
      body.classList.add('open');
      if (chevron) chevron.style.transform = 'rotate(90deg)';
    }
  }
}

// ── FAB (Floating Action Button) ──────────────────────────────
export function openFab(): void {
  document.getElementById('fab-panel')?.classList.add('open');
  document.getElementById('fab-btn')?.classList.add('open');
}

export function closeFab(): void {
  document.getElementById('fab-panel')?.classList.remove('open');
  document.getElementById('fab-btn')?.classList.remove('open');
  closeBugForm();
}

export function toggleFab(): void {
  const panel = document.getElementById('fab-panel');
  if (panel?.classList.contains('open')) {
    closeFab();
  } else {
    openFab();
  }
}

export function switchFabTab(tabName: string): void {
  document.querySelectorAll('.fab-tab').forEach((btn) => {
    (btn as HTMLElement).classList.toggle('active', (btn as HTMLElement).dataset.tab === tabName);
  });
  document.querySelectorAll('.fab-tab-content').forEach((div) => {
    (div as HTMLElement).classList.toggle('active', div.id === `fab-tab-${tabName}`);
  });
}
