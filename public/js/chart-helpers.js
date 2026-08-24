function getChartCtor() {
  return window.Chart;
}
// Destroys `existing` (if any) and constructs a new chart from `buildConfig()`.
// `buildConfig` is only invoked once canvas/Chart.js are confirmed present, so
// callers can build an expensive config lazily. Returns `existing` unchanged
// (no destroy) when the canvas isn't in the DOM yet or Chart.js hasn't loaded;
// returns null (chart destroyed, nothing rendered) when `buildConfig` itself
// returns null, e.g. for an empty dataset.
export function updateChart(canvas, existing, buildConfig) {
  const ChartCtor = getChartCtor();
  if (!canvas || typeof ChartCtor === 'undefined') return existing;
  if (existing) existing.destroy();
  const config = buildConfig();
  if (!config) return null;
  return new ChartCtor(canvas, config);
}
//# sourceMappingURL=chart-helpers.js.map
