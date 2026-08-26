// ── Unit tests: public/js/actions.js ────────────────────────────────────────
// The click registry (registerActions/dispatchAction) has no existing direct
// test file — it's exercised indirectly wherever consuming modules register
// against it (e.g. documentation.test.js asserting DOC_ACTIONS values). The
// registry logic itself (registration, duplicate-throw, dispatch/fallback) is
// cheap pure logic though, so this file adds direct coverage for the new
// change-action registry added alongside it (issue #461 change-event spike) —
// registerChangeActions/dispatchChangeAction, mirrored from registerActions/
// dispatchAction. A fresh module instance is imported per test (via a cache-
// busting query string) so one test's registrations can't collide with
// another's — registerChangeActions throws on a duplicate name, and the
// registry is shared module-level state with no reset function.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

let _importCounter = 0;
async function freshActionsModule() {
  _importCounter += 1;
  return import(`../../public/js/actions.js?t=${_importCounter}`);
}

describe('registerChangeActions / dispatchChangeAction', () => {
  test('dispatchChangeAction returns false and does not throw for an unregistered name', async () => {
    const { dispatchChangeAction } = await freshActionsModule();
    const el = {};
    const result = dispatchChangeAction('nobodyRegisteredThis', el, { type: 'change' });
    assert.equal(result, false);
  });

  test('a registered change action is invoked with the element and event, and dispatch returns true', async () => {
    const { registerChangeActions, dispatchChangeAction } = await freshActionsModule();
    const calls = [];
    registerChangeActions({
      myChangeAction: (el, e) => calls.push([el, e]),
    });
    const el = { tagName: 'SELECT' };
    const e = { type: 'change' };
    const result = dispatchChangeAction('myChangeAction', el, e);
    assert.equal(result, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], el);
    assert.equal(calls[0][1], e);
  });

  test('registering the same change action name twice throws', async () => {
    const { registerChangeActions } = await freshActionsModule();
    registerChangeActions({ dupeAction: () => {} });
    assert.throws(() => registerChangeActions({ dupeAction: () => {} }), /already registered/);
  });

  test('a change action name may collide with a click action name registered in the same module instance', async () => {
    const { registerActions, registerChangeActions, dispatchAction, dispatchChangeAction } =
      await freshActionsModule();
    const clickCalls = [];
    const changeCalls = [];
    // Same name, registered against both registries — should not throw, and
    // each dispatcher should only ever invoke its own handler.
    registerActions({ sharedName: () => clickCalls.push('click') });
    registerChangeActions({ sharedName: () => changeCalls.push('change') });

    dispatchAction('sharedName', {}, { type: 'click' });
    assert.deepEqual(clickCalls, ['click']);
    assert.deepEqual(changeCalls, []);

    dispatchChangeAction('sharedName', {}, { type: 'change' });
    assert.deepEqual(clickCalls, ['click']);
    assert.deepEqual(changeCalls, ['change']);
  });
});
