// ── Shared Chart.js wrapper types + lifecycle helper ──────────────────────────
// Chart.js is loaded globally via a <script> tag (not an ES import), so callers
// only have `window.Chart` with no bundled types. This is the single place that
// casts the global and handles the destroy-existing-then-construct-new pattern
// every chart-rendering view (ai-savings.ts, bugs-dashboard.ts) needs.
export interface ChartInstance {
  destroy(): void;
}

export interface ChartConstructor {
  new (ctx: HTMLCanvasElement, config: Record<string, unknown>): ChartInstance;
}

function getChartCtor(): ChartConstructor | undefined {
  return (window as unknown as { Chart?: ChartConstructor }).Chart;
}

// Destroys `existing` (if any) and constructs a new chart from `buildConfig()`.
// `buildConfig` is only invoked once canvas/Chart.js are confirmed present, so
// callers can build an expensive config lazily. Returns `existing` unchanged
// (no destroy) when the canvas isn't in the DOM yet or Chart.js hasn't loaded;
// returns null (chart destroyed, nothing rendered) when `buildConfig` itself
// returns null, e.g. for an empty dataset.
export function updateChart(
  canvas: HTMLCanvasElement | null,
  existing: ChartInstance | null,
  buildConfig: () => Record<string, unknown> | null
): ChartInstance | null {
  const ChartCtor = getChartCtor();
  if (!canvas || typeof ChartCtor === 'undefined') return existing;
  if (existing) existing.destroy();
  const config = buildConfig();
  if (!config) return null;
  return new ChartCtor(canvas, config);
}
