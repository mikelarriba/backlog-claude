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
}

let _availableProviders: Provider[] = [];

export async function loadModelSetting(): Promise<void> {
  try {
    const [providersData, modelData] = await Promise.all([
      fetchJSON('/api/settings/providers') as Promise<{ providers: Provider[] }>,
      fetchJSON('/api/settings/model') as Promise<{ model: string; provider: string }>,
    ]);
    _availableProviders = (providersData as { providers: Provider[] }).providers || [];
    const { model, provider } = modelData as { model: string; provider: string };
    _renderProviderDropdown(provider || 'claude-cli');
    _renderModelDropdown(provider || 'claude-cli', model || '');
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

export async function onProviderChange(providerId: string): Promise<void> {
  _renderModelDropdown(providerId, '');
  await _saveModelSetting(providerId, '');
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
  } catch (e) {
    console.warn('Failed to refresh providers:', (e as Error).message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

export async function updateModelSetting(model: string): Promise<void> {
  const providerSel = document.getElementById('provider-select') as HTMLSelectElement | null;
  const providerId = providerSel ? providerSel.value : 'claude-cli';
  await _saveModelSetting(providerId, model);
}

async function _saveModelSetting(provider: string, model: string): Promise<void> {
  const statusEl = document.getElementById('model-status');
  try {
    await putJSON('/api/settings/model', { provider: provider || null, model: model || null });
    if (statusEl) {
      statusEl.className = 'model-status show success';
      const pName = (_availableProviders.find((p) => p.id === provider) || { name: provider }).name;
      statusEl.textContent = model ? `Using ${pName} / ${model}` : `Using ${pName} default`;
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
