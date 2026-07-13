// ── SSE client: server-sent event handling + reconnection ────────
// Applies granular in-memory store updates from push events and falls
// back to a debounced full reload for events that don't carry a doc
// payload. Reconnects with exponential backoff on connection loss.
import { debounce } from './state.js';
import { upsertDoc, removeDoc, setPiSettings } from './store.js';
import { loadDocs } from './list.js';
import { loadAllSprintConfigs } from './piconfig.js';
import { refreshRoadmapView } from './roadmap.js';
import { handleSkillSSE } from './skills.js';
const _loadDocsDebounced = debounce(loadDocs, 100);
// ── SSE with exponential backoff reconnection ─────────────────
let _sseRetryDelay = 1000;
const SSE_MAX_DELAY = 30000;
function _handleSSEMessage(payload) {
    // Granular in-memory update when server includes the full DocEntry.
    // Avoids a round-trip GET /api/docs for single-document operations.
    // upsertDoc / removeDoc emit domain events that trigger subscribers.
    if (payload.doc) {
        upsertDoc(payload.doc);
        return;
    }
    if (payload.type === 'doc_deleted' && payload.filename) {
        removeDoc(payload.filename);
        return;
    }
    if ([
        'feature_created',
        'epic_created',
        'story_created',
        'spike_created',
        'bug_created',
        'status_updated',
        'title_updated',
        'doc_deleted',
        'batch_deleted',
        'batch_fix_version_updated',
        'batch_field_updated',
        'link_updated',
    ].includes(payload.type ?? '')) {
        _loadDocsDebounced();
    }
    if (payload.type === 'pi_settings_updated') {
        setPiSettings({ currentPi: payload.currentPi ?? null, nextPi: payload.nextPi ?? null });
        loadAllSprintConfigs().then(() => {
            _loadDocsDebounced();
            refreshRoadmapView();
        });
    }
    if (payload.type === 'sprint_settings_updated') {
        loadAllSprintConfigs().then(() => {
            _loadDocsDebounced();
            refreshRoadmapView();
        });
    }
    if (payload.type === 'batch_sprint_updated') {
        _loadDocsDebounced();
        refreshRoadmapView();
    }
    if (payload.type === 'split_threshold_updated') {
        splitThreshold = payload.splitThreshold ?? splitThreshold;
        const el = document.getElementById('split-threshold-input');
        if (el)
            el.value = String(splitThreshold);
        refreshRoadmapView();
    }
    if (payload.type === 'skill_updated' ||
        payload.type === 'skill_reset' ||
        payload.type === 'product_context_updated' ||
        payload.type === 'product_context_reset') {
        handleSkillSSE(payload);
    }
}
export function _connectSSE() {
    const es = new EventSource('/api/events');
    es.onopen = () => {
        _sseRetryDelay = 1000;
    };
    es.onmessage = (e) => {
        try {
            _handleSSEMessage(JSON.parse(e.data));
        }
        catch (err) {
            console.warn('SSE handler error:', err.message);
        }
    };
    es.onerror = () => {
        es.close();
        const jitter = Math.random() * 500;
        setTimeout(_connectSSE, Math.min(_sseRetryDelay + jitter, SSE_MAX_DELAY));
        _sseRetryDelay = Math.min(_sseRetryDelay * 2, SSE_MAX_DELAY);
    };
}
//# sourceMappingURL=sse-client.js.map