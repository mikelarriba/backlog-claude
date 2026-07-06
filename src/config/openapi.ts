// ── OpenAPI spec (see src/config/openapi/ for the feature-area path files) ────
// Kept as a thin re-export so `../config/openapi.js` keeps working for existing
// importers (src/app/routes.ts) without changing their import path.
export { buildOpenApiSpec } from './openapi/index.js';
