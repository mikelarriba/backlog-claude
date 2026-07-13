import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// Cross-file globals used by the frontend's legacy shared-state pattern.
// These window properties are defined in state.js and read across other modules.
// This list will shrink as files are migrated to ES modules in Phase 3.
const FRONTEND_GLOBALS = {
  // State variables (from state.js _storeVar)
  allDocs: 'writable',
  piSettings: 'writable',
  sprintConfig: 'writable',
  currentFilename: 'writable',
  currentDocType: 'writable',
  currentJiraId: 'writable',
  jiraBase: 'writable',
  jiraSearchResults: 'writable',
  jiraVersions: 'writable',
  selectedItems: 'writable',
  splitThreshold: 'writable',
  activeStatusFilter: 'writable',
  activeTeamFilter: 'writable',
  activeTypeFilter: 'writable',
  activeWorkCatFilter: 'writable',
  // Internal UI state variables
  _activePanelState: 'writable',
  _canvasDocType: 'writable',
  _canvasEpicFilename: 'writable',
  _canvasManageLinks: 'writable',
  _canvasSelectedCards: 'writable',
  _collapsedItems: 'writable',
  _justDragged: 'writable',
  _lastClickedItem: 'writable',
  _metaTeams: 'writable',
  _metaWorkCategories: 'writable',
  _panelStates: 'writable',
  _parseComments: 'writable',
  _piConfigActivePi: 'writable',
  _quickCreateType: 'writable',
  _renderComments: 'writable',
  _roadmapVisiblePis: 'writable',
  _showEpicContextMenu: 'writable',
  _showFpCardContextMenu: 'writable',
  _swimlanesCollapsed: 'writable',
  _toastTimer: 'writable',
  // Cross-module functions (still set on window via _dynGlobals in main.ts)
  openDoc: 'readonly',
  closeAllDropdowns: 'readonly',
  focusEpic: 'readonly',
  updateSplitMode: 'readonly',
  // Third-party libraries loaded via <script> tags
  marked: 'readonly',
  DOMPurify: 'readonly',
  // Loop variable used in some files
  child: 'writable',
};

export default [
  // Ignore patterns
  {
    ignores: ['node_modules/**', 'public/js/vendor/**', 'dist/**', 'tests/helpers/**'],
  },

  // Base JS recommended for all files
  js.configs.recommended,

  // TypeScript ESLint — scoped to TS files only
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['src/**/*.ts', 'server.ts'],
  })),

  // Backend TypeScript rules
  {
    files: ['src/**/*.ts', 'server.ts'],
    rules: {
      'no-unused-vars': 'off', // superseded by @typescript-eslint/no-unused-vars
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-console': 'off',
      'preserve-caught-error': 'off',
    },
  },

  // Frontend JavaScript files
  {
    files: ['public/js/**/*.js'],
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-console': 'off',
    },
    languageOptions: {
      globals: {
        // Standard browser globals
        window: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        EventSource: 'readonly',
        Blob: 'readonly',
        FileReader: 'readonly',
        FormData: 'readonly',
        MutationObserver: 'readonly',
        ResizeObserver: 'readonly',
        IntersectionObserver: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        performance: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        history: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        CustomEvent: 'readonly',
        Event: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLSelectElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        HTMLCanvasElement: 'readonly',
        CanvasRenderingContext2D: 'readonly',
        Element: 'readonly',
        Node: 'readonly',
        NodeList: 'readonly',
        DOMParser: 'readonly',
        XMLHttpRequest: 'readonly',
        Headers: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        Image: 'readonly',
        Worker: 'readonly',
        ServiceWorker: 'readonly',
        MediaQueryList: 'readonly',
        matchMedia: 'readonly',
        getComputedStyle: 'readonly',
        structuredClone: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        queueMicrotask: 'readonly',
        crypto: 'readonly',
        CSS: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        // Frontend shared state globals
        ...FRONTEND_GLOBALS,
      },
    },
  },

  // Service worker — runs in ServiceWorkerGlobalScope, not browser window
  {
    files: ['sw.js'],
    languageOptions: {
      globals: {
        self: 'readonly',
        caches: 'readonly',
        fetch: 'readonly',
        clients: 'readonly',
        console: 'readonly',
      },
    },
  },

  // Test files
  {
    files: ['tests/**/*.js'],
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'off',
    },
  },

  // Disable Prettier-conflicting rules
  prettier,
];
