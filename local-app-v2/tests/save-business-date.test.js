const test = require('node:test');
const assert = require('node:assert/strict');

const authPath = require.resolve('../src/auth/middleware');
const dataPath = require.resolve('../src/sheets/data-store');
let writes = 0;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  authMiddleware(req, _res, next) { req.user = { email: 'manager@example.test' }; next(); },
  verifyGoogleToken() {},
} };
require.cache[dataPath] = { id: dataPath, filename: dataPath, loaded: true, exports: {
  async saveChoreiCasts() { writes++; },
  async saveCastGoal() { writes++; return true; },
  async saveShurei() { writes++; },
} };
process.env.VERCEL = '1';
const app = require('../server');

test('rejects old or missing business dates on all chorei, goal and shurei writes', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { date } = await fetch(`${origin}/api/business-date`).then(r => r.json());
  for (const endpoint of ['chorei', 'cast-goal', 'shurei']) {
    for (const suppliedDate of ['2000-01-01', undefined]) {
      const response = await fetch(`${origin}/api/${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: suppliedDate, storeCode: 'A', casts: [] }),
      });
      assert.equal(response.status, 409);
      assert.equal((await response.json()).success, false);
    }
  }
  assert.equal(writes, 0);
  for (const endpoint of ['chorei', 'cast-goal', 'shurei']) {
    const response = await fetch(`${origin}/api/${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, storeCode: 'A', casts: [] }),
    });
    assert.equal((await response.json()).success, true);
  }
  assert.equal(writes, 3);
});
