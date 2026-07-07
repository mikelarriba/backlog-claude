// ── Settings view: AI model / provider selection ─────────────────
// Populates the provider/model dropdowns in the Settings view and
// persists the selection.
import { fetchJSON, putJSON, toggleSection } from './state.js';
export function toggleModelSection() {
  toggleSection('model-section-body', 'model-chevron');
}
let _availableProviders = [];
export async function loadModelSetting() {
  try {
    const [providersData, modelData] = await Promise.all([
      fetchJSON('/api/settings/providers'),
      fetchJSON('/api/settings/model'),
    ]);
    _availableProviders = providersData.providers || [];
    const { model, provider } = modelData;
    _renderProviderDropdown(provider || 'claude-cli');
    _renderModelDropdown(provider || 'claude-cli', model || '');
  } catch (e) {
    console.warn('Failed to load model setting:', e.message);
  }
}
function _renderProviderDropdown(selectedProvider) {
  const sel = document.getElementById('provider-select');
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
function _renderModelDropdown(providerId, selectedModel) {
  const sel = document.getElementById('model-select');
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
export async function onProviderChange(providerId) {
  _renderModelDropdown(providerId, '');
  await _saveModelSetting(providerId, '');
}
export async function refreshProviders() {
  const btn = document.getElementById('provider-refresh-btn');
  if (btn) btn.disabled = true;
  try {
    const data = await fetchJSON('/api/settings/providers');
    _availableProviders = data.providers || [];
    const providerSel = document.getElementById('provider-select');
    const currentProvider = providerSel ? providerSel.value : 'claude-cli';
    const modelSel = document.getElementById('model-select');
    const currentModel = modelSel ? modelSel.value : '';
    _renderProviderDropdown(currentProvider);
    _renderModelDropdown(currentProvider, currentModel);
  } catch (e) {
    console.warn('Failed to refresh providers:', e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}
export async function updateModelSetting(model) {
  const providerSel = document.getElementById('provider-select');
  const providerId = providerSel ? providerSel.value : 'claude-cli';
  await _saveModelSetting(providerId, model);
}
async function _saveModelSetting(provider, model) {
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
//# sourceMappingURL=provider-settings.js.map
