const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../public/scripts/app.js'), 'utf8');
function functionSource(name, next) {
  return source.slice(source.indexOf(`function ${name}(`), source.indexOf(next, source.indexOf(`function ${name}(`)));
}

test('autosave shows the real server error, including the translated quota message', () => {
  const context = vm.createContext({});
  vm.runInContext(functionSource('isQuotaMessage', 'async function api('), context);
  vm.runInContext(functionSource('getAutoSaveErrorMessage', 'async function runAutoSave('), context);
  assert.equal(context.getAutoSaveErrorMessage({ error: 'permission denied' }), 'permission denied');
  assert.equal(context.getAutoSaveErrorMessage({ error: '混雑中です。少し待ってから再度保存してください' }), '混雑中です。少し待ってから再度保存してください');
  assert.equal(context.getAutoSaveErrorMessage({ error: 'Quota exceeded' }), '混雑中です。少し待ってから再度保存してください');
});

test('a failed save remains visible until another save changes its status', () => {
  let scheduled = 0;
  const element = { classList: { remove() {}, add() {} } };
  const context = vm.createContext({ document: { getElementById: () => element }, clearTimeout() {}, setTimeout() { scheduled++; } });
  vm.runInContext(functionSource('showAutoSaveStatus', 'const AUTO_SAVE_DELAY_MS'), context);
  context.showAutoSaveStatus('status', 'error', 'failed');
  assert.equal(element.textContent, 'failed');
  assert.equal(scheduled, 0);
});

test('chorei save sends explicit removals with its business date and retains them on failure', async () => {
  const removal = { storeCode: 'A', date: '2026-10-16', gmail: 'removed@example.test', castName: 'removed' };
  const other = { storeCode: 'B', date: '2026-10-16', gmail: 'other@example.test' };
  let success = false;
  let body;
  const state = { storeCode: 'A', businessDate: '2026-10-16', choreiRemovals: [removal, other] };
  const context = vm.createContext({ State: state, api: async (_url, options) => { body = JSON.parse(options.body); return { success }; } });
  const start = source.indexOf('async function saveChoreiPayload(');
  vm.runInContext(source.slice(start, source.indexOf('async function doSaveShurei(', start)), context);
  await context.saveChoreiPayload([]);
  assert.equal(body.date, '2026-10-16');
  assert.deepEqual(body.removedCasts, [{ gmail: removal.gmail, castName: removal.castName }]);
  assert.equal(state.choreiRemovals.length, 2);
  success = true;
  await context.saveChoreiPayload([]);
  assert.equal(state.choreiRemovals.length, 1);
  assert.equal(state.choreiRemovals[0], other);
});
