// ── Settings view: AI model / provider selection ─────────────────
// Populates the provider/model dropdowns in the Settings view and
// persists the selection.
import { fetchJSON, putJSON, toggleSection } from './state.js';

export function toggleModelSection(): void {
  toggleSection('model-section-body', 'model-chevron');
}

interface ProviderModel {
  id: string;
  name: string;
}

interface Provider {
  id: string;
  name: string;
  models: ProviderModel[];
  effortLevels?: string[];
}

let _availableProviders: Provider[] = [];
let _currentEffort = '';

export async function loadModelSetting(): Promise<void> {
  try {
    const [providersData, modelData] = await Promise.all([
      fetchJSON('/api/settings/providers') as Promise<{ providers: Provider[] }>,
      fetchJSON('/api/settings/model') as Promise<{
        model: string;
        provider: string;
        effort?: string;
      }>,
    ]);
    _availableProviders = (providersData as { providers: Provider[] }).providers || [];
    const { model, provider, effort } = modelData as {
      model: string;
      provider: string;
      effort?: string;
    };
    _currentEffort = effort || '';
    _renderProviderDropdown(provider || 'claude-cli');
    _renderModelDropdown(provider || 'claude-cli', model || '');
    _renderEffortDropdown(provider || 'claude-cli', _currentEffort);
  } catch (e) {
    console.warn('Failed to load model setting:', (e as Error).message);
  }
}

function _renderProviderDropdown(selectedProvider: string): void {
  const sel = document.getElementById('provider-select') as HTMLSelectElement | null;
  if (!sel) return;
  sel.innerHTML = '';
  for (const p of _availableProviders) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === selectedProvider) opt.selected = true;
    sel.appendChild(opt);
  }
}

function _renderModelDropdown(providerId: string, selectedModel: string): void {
  const sel = document.getElementById('model-select') as HTMLSelectElement | null;
  if (!sel) return;
  const provider = _availableProviders.find((p) => p.id === providerId);
  sel.innerHTML = '';
  if (!provider) return;
  for (const m of provider.models) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    if (m.id === selectedModel) opt.selected = true;
    sel.appendChild(opt);
  }
}

function _renderEffortDropdown(providerId: string, selectedEffort: string): void {
  const field = document.getElementById('effort-field') as HTMLElement | null;
  const sel = document.getElementById('effort-select') as HTMLSelectElement | null;
  if (!sel || !field) return;
  const provider = _availableProviders.find((p) => p.id === providerId);
  const levels = provider?.effortLevels || [];
  if (!levels.length) {
    field.style.display = 'none';
    sel.innerHTML = '';
    return;
  }
  field.style.display = '';
  sel.innerHTML = '';
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'Default';
  if (!selectedEffort) defaultOpt.selected = true;
  sel.appendChild(defaultOpt);
  for (const level of levels) {
    const opt = document.createElement('option');
    opt.value = level;
    opt.textContent = level.charAt(0).toUpperCase() + level.slice(1);
    if (level === selectedEffort) opt.selected = true;
    sel.appendChild(opt);
  }
}

export async function onProviderChange(providerId: string): Promise<void> {
  _renderModelDropdown(providerId, '');
  _currentEffort = '';
  _renderEffortDropdown(providerId, '');
  await _saveModelSetting(providerId, '', '');
}

export async function refreshProviders(): Promise<void> {
  const btn = document.getElementById('provider-refresh-btn') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  try {
    const data = (await fetchJSON('/api/settings/providers')) as { providers: Provider[] };
    _availableProviders = data.providers || [];
    const providerSel = document.getElementById('provider-select') as HTMLSelectElement | null;
    const currentProvider = providerSel ? providerSel.value : 'claude-cli';
    const modelSel = document.getElementById('model-select') as HTMLSelectElement | null;
    const currentModel = modelSel ? modelSel.value : '';
    _renderProviderDropdown(currentProvider);
    _renderModelDropdown(currentProvider, currentModel);
    _renderEffortDropdown(currentProvider, _currentEffort);
  } catch (e) {
    console.warn('Failed to refresh providers:', (e as Error).message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

export async function updateModelSetting(model: string): Promise<void> {
  const providerSel = document.getElementById('provider-select') as HTMLSelectElement | null;
  const providerId = providerSel ? providerSel.value : 'claude-cli';
  await _saveModelSetting(providerId, model, _currentEffort);
}

export async function updateEffortSetting(effort: string): Promise<void> {
  _currentEffort = effort;
  const providerSel = document.getElementById('provider-select') as HTMLSelectElement | null;
  const providerId = providerSel ? providerSel.value : 'claude-cli';
  const modelSel = document.getElementById('model-select') as HTMLSelectElement | null;
  const model = modelSel ? modelSel.value : '';
  await _saveModelSetting(providerId, model, effort);
}

async function _saveModelSetting(provider: string, model: string, effort: string): Promise<void> {
  const statusEl = document.getElementById('model-status');
  try {
    await putJSON('/api/settings/model', {
      provider: provider || null,
      model: model || null,
      effort: effort || null,
    });
    if (statusEl) {
      statusEl.className = 'model-status show success';
      const pName = (_availableProviders.find((p) => p.id === provider) || { name: provider }).name;
      const modelLabel = model ? `/ ${model}` : '';
      const effortLabel = effort ? ` (effort: ${effort})` : '';
      statusEl.textContent = model
        ? `Using ${pName} ${modelLabel}${effortLabel}`
        : `Using ${pName} default${effortLabel}`;
      setTimeout(() => {
        statusEl.className = 'model-status';
      }, 3000);
    }
  } catch {
    if (statusEl) {
      statusEl.className = 'model-status show error';
      statusEl.textContent = 'Failed to save';
    }
  }
}
