# Contributing to MIDAS Backlog

## Prerequisites

- Node.js 20 (matches CI and the production Docker image)
- `npm ci` to install dependencies

## Running locally

```bash
cp .env.example .env   # fill in ANTHROPIC_API_KEY and JIRA_* vars
npm start              # starts the server on http://localhost:3000
```

## Running tests

```bash
npm test               # unit + integration tests (with coverage output)
npm run test:e2e       # Playwright end-to-end tests
npm run test:bench     # performance benchmarks
```

## Adding a new document type

Document types (Epic, Story, Spike, Bug, …) are defined in a single source of truth:

**[src/config/docTypes.ts](src/config/docTypes.ts)**

Add an entry there — the registry controls the route prefix, display name, default frontmatter, and JIRA issue-type mappings. You should not need to touch individual route files for a new type.

## Adding a new backend route

1. Create a new file in `src/routes/` — follow the thin-route pattern (parse → call service → shape response).
2. Register it in `src/app/routes.ts`.
3. Inject any new services through `src/app/context.ts` (the DI container).
4. Write at least one integration test in `tests/integration/`.

## Adding a new frontend module

1. Create `public/ts/<module>.ts` — use `import`/`export` (ES modules, no `window.*` assignments).
2. Import the new module from `public/ts/main.ts` and wire up any event listeners there.
3. Run `npm run build:frontend` to compile — the compiled `public/js/<module>.js` must be committed alongside the TS source (CI will fail if they drift).
4. Shared utilities (escaping, fetch, markdown rendering) live in `public/ts/state.ts` — import from there, don't reimplement.

## Rendering markdown safely

Always use `renderMarkdown()` from `state.ts` — never call `marked.parse()` directly into `innerHTML`:

```ts
import { renderMarkdown } from './state.js';

el.innerHTML = renderMarkdown(markdownString); // sanitized via DOMPurify
```

## Code style

- TypeScript strict mode is enforced — `npm run typecheck` must pass.
- ESLint + Prettier are enforced via `npm run lint` and `npm run format:check`.
- Pre-commit hooks run lint-staged, backend typecheck, and frontend typecheck automatically.

## CI checks

Every PR must pass:

- `typecheck` (backend)
- `typecheck:frontend`
- `lint` + `format:check`
- `test` (unit + integration, with coverage report)
- `frontend-drift` — the compiled `public/js/` must match the TS source; run `npm run build:frontend` and commit the result before pushing
