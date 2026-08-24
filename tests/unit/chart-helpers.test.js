// ── Unit tests: public/js/chart-helpers.js ─────────────────────────────────────
// Extracted (#542) out of ai-savings.ts/bugs-dashboard.ts's duplicated Chart.js
// wrapper boilerplate. updateChart() had zero coverage of its own — this is the
// next increment of issue #460's module-by-module unit-test pass, adding it as
// a newly-added-since-last-pass candidate.
//
// Chart.js is a plain `window.Chart` global (not an ES import), so this only
// needs the domGlobals shim (window aliased to globalThis) to stand a fake
// constructor in for it — same pattern as ai-savings.test.js/list-render.test.js.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';

const { updateChart } = await import('../../public/js/chart-helpers.js');

function fakeCanvas() {
  return {};
}

function fakeExistingChart() {
  let destroyed = false;
  return {
    get destroyed() {
      return destroyed;
    },
    destroy() {
      destroyed = true;
    },
  };
}

let _origChart;
beforeEach(() => {
  _origChart = window.Chart;
});
afterEach(() => {
  window.Chart = _origChart;
});

describe('updateChart()', () => {
  test('returns `existing` unchanged (no destroy) when canvas is null', () => {
    window.Chart = function FakeChart() {
      throw new Error('should not construct a chart when canvas is null');
    };
    const existing = fakeExistingChart();
    const result = updateChart(null, existing, () => ({ type: 'bar' }));
    assert.equal(result, existing);
    assert.equal(existing.destroyed, false);
  });

  test('returns `existing` unchanged (no destroy) when window.Chart is not loaded yet', () => {
    window.Chart = undefined;
    const existing = fakeExistingChart();
    const result = updateChart(fakeCanvas(), existing, () => ({ type: 'bar' }));
    assert.equal(result, existing);
    assert.equal(existing.destroyed, false);
  });

  test('does not call buildConfig when canvas or Chart.js is missing', () => {
    window.Chart = undefined;
    let called = false;
    updateChart(fakeCanvas(), null, () => {
      called = true;
      return { type: 'bar' };
    });
    assert.equal(called, false);
  });

  test('destroys `existing` and returns null when buildConfig returns null (e.g. empty dataset)', () => {
    let constructed = false;
    window.Chart = function FakeChart() {
      constructed = true;
    };
    const existing = fakeExistingChart();
    const result = updateChart(fakeCanvas(), existing, () => null);
    assert.equal(existing.destroyed, true);
    assert.equal(constructed, false);
    assert.equal(result, null);
  });

  test("constructs a new chart on the given canvas with buildConfig()'s config when there is no existing chart", () => {
    const canvas = fakeCanvas();
    const config = { type: 'line', data: {} };
    let passedArgs = null;
    window.Chart = function FakeChart(ctx, cfg) {
      passedArgs = [ctx, cfg];
      this.destroy = () => {};
    };
    const result = updateChart(canvas, null, () => config);
    assert.deepEqual(passedArgs, [canvas, config]);
    assert.ok(result instanceof window.Chart);
  });

  test('destroys the existing chart before constructing the new one', () => {
    const order = [];
    window.Chart = function FakeChart() {
      order.push('construct');
    };
    const existing = {
      destroy: () => order.push('destroy'),
    };
    updateChart(fakeCanvas(), existing, () => ({ type: 'bar' }));
    assert.deepEqual(order, ['destroy', 'construct']);
  });
});
