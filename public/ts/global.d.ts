// ── Global variable declarations for store-backed window properties ──────────
// These are created by _storeVar() in state.ts and accessed as globals in the
// browser. Declaring them here lets TypeScript resolve them in strict mode.

import type { DocEntry, PISettings, SprintConfig, SwimlaneCollapsed, PanelState } from './state.js';

declare global {
  // ── CDN globals ────────────────────────────────────────────────────────────
  var marked: { parse: (src: string) => string };

  // ── Window-exposed handler functions (set by main.ts via Object.assign) ───
  var openDoc: (filename: string, docType: string) => void;
  var focusEpic: (filename: string) => void;

  interface Window {
    setTheme: (preference: string) => void;
  }

  // ── Store-backed state variables ───────────────────────────────────────────
  var allDocs: DocEntry[];
  var jiraBase: string;
  var currentFilename: string | null;
  var currentDocType: string | null;
  var activeTypeFilter: string;
  var activeStatusFilter: string;
  var activeTeamFilter: string;
  var activeWorkCatFilter: string;
  var currentJiraId: string | null;
  var _justDragged: boolean;
  var _quickCreateType: string | null;
  var _toastTimer: ReturnType<typeof setTimeout> | null;
  var selectedItems: Set<string>;
  var _lastClickedItem: string | null;
  var jiraSearchResults: DocEntry[];
  var sprintConfig: SprintConfig;
  var splitThreshold: number;
  var _metaTeams: string[];
  var _metaWorkCategories: string[];
  var piSettings: PISettings;
  var jiraVersions: string[];
  var _swimlanesCollapsed: SwimlaneCollapsed;
  var _collapsedItems: Set<string>;
  var _piConfigActivePi: string | null;
  var _canvasEpicFilename: string | null;
  var _canvasDocType: string | null;
  var _canvasManageLinks: boolean;
  var _canvasSelectedCards: Set<string>;
  var _activePanelState: PanelState;
  var _panelStates: Map<string, PanelState>;
  var _roadmapVisiblePis: Set<string>;
}
