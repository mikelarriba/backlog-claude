// ── Settings view: AI model / provider selection ─────────────────
// Populates the provider/model dropdowns in the Settings view and
// persists the selection.
import { fetchJSON, putJSON, toggleSection } from './state.js';
export function toggleModelSection() {
    toggleSection('model-section-body', 'model-chevron');
}
let _availableProviders = [];
let _currentEffort = '';
export async function loadModelSetting() {
    try {
        const [providersData, modelData] = await Promise.all([
            fetchJSON('/api/settings/providers'),
            fetchJSON('/api/settings/model'),
        ]);
        _availableProviders = providersData.providers || [];
        const { model, provider, effort } = modelData;
        _currentEffort = effort || '';
        _renderProviderDropdown(provider || 'claude-cli');
        _renderModelDropdown(provider || 'claude-cli', model || '');
        _renderEffortDropdown(provider || 'claude-cli', _currentEffort);
    }
    catch (e) {
        console.warn('Failed to load model setting:', e.message);
    }
}
function _renderProviderDropdown(selectedProvider) {
    const sel = document.getElementById('provider-select');
    if (!sel)
        return;
    sel.innerHTML = '';
    for (const p of _availableProviders) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        if (p.id === selectedProvider)
            opt.selected = true;
        sel.appendChild(opt);
    }
}
function _renderModelDropdown(providerId, selectedModel) {
    const sel = document.getElementById('model-select');
    if (!sel)
        return;
    const provider = _availableProviders.find((p) => p.id === providerId);
    sel.innerHTML = '';
    if (!provider)
        return;
    for (const m of provider.models) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name;
        if (m.id === selectedModel)
            opt.selected = true;
        sel.appendChild(opt);
    }
}
function _renderEffortDropdown(providerId, selectedEffort) {
    const field = document.getElementById('effort-field');
    const sel = document.getElementById('effort-select');
    if (!sel || !field)
        return;
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
    if (!selectedEffort)
        defaultOpt.selected = true;
    sel.appendChild(defaultOpt);
    for (const level of levels) {
        const opt = document.createElement('option');
        opt.value = level;
        opt.textContent = level.charAt(0).toUpperCase() + level.slice(1);
        if (level === selectedEffort)
            opt.selected = true;
        sel.appendChild(opt);
    }
}
export async function onProviderChange(providerId) {
    _renderModelDropdown(providerId, '');
    _currentEffort = '';
    _renderEffortDropdown(providerId, '');
    await _saveModelSetting(providerId, '', '');
}
export async function refreshProviders() {
    const btn = document.getElementById('provider-refresh-btn');
    if (btn)
        btn.disabled = true;
    try {
        const data = (await fetchJSON('/api/settings/providers'));
        _availableProviders = data.providers || [];
        const providerSel = document.getElementById('provider-select');
        const currentProvider = providerSel ? providerSel.value : 'claude-cli';
        const modelSel = document.getElementById('model-select');
        const currentModel = modelSel ? modelSel.value : '';
        _renderProviderDropdown(currentProvider);
        _renderModelDropdown(currentProvider, currentModel);
        _renderEffortDropdown(currentProvider, _currentEffort);
    }
    catch (e) {
        console.warn('Failed to refresh providers:', e.message);
    }
    finally {
        if (btn)
            btn.disabled = false;
    }
}
export async function updateModelSetting(model) {
    const providerSel = document.getElementById('provider-select');
    const providerId = providerSel ? providerSel.value : 'claude-cli';
    await _saveModelSetting(providerId, model, _currentEffort);
}
export async function updateEffortSetting(effort) {
    _currentEffort = effort;
    const providerSel = document.getElementById('provider-select');
    const providerId = providerSel ? providerSel.value : 'claude-cli';
    const modelSel = document.getElementById('model-select');
    const model = modelSel ? modelSel.value : '';
    await _saveModelSetting(providerId, model, effort);
}
async function _saveModelSetting(provider, model, effort) {
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
    }
    catch {
        if (statusEl) {
            statusEl.className = 'model-status show error';
            statusEl.textContent = 'Failed to save';
        }
    }
}
//# sourceMappingURL=provider-settings.js.map