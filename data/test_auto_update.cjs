const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../docs/app.js'), 'utf8');
const code = source.slice(source.indexOf('(async function autoUpdate()'));
const response = (value, type = 'application/json', ok = true) => ({
  ok, headers: { get: () => type }, json: async () => value, text: async () => value,
});
async function run(responses, protocol = 'http:') {
  const notice = { setAttribute() {}, style: {} };
  let reloads = 0;
  const context = {
    document: { createElement: () => notice, body: { prepend() {} } },
    window: { DLT_META: { last: '26127', revision: 'current' } },
    location: { protocol, reload() { reloads++; } },
    fetch: async () => {
      assert.ok(responses.length, 'Unexpected fetch');
      return responses.shift();
    },
  };
  await vm.runInNewContext(code, context);
  return { notice: notice.textContent, reloads };
}
(async () => {
  const data = revision => response(`window.DLT_META = ${JSON.stringify({ last: '26127', revision })};`, 'text/javascript');
  assert.equal((await run([response({ ok: true, changed: true }), data('current')])).reloads, 0);
  assert.equal((await run([response({ ok: true, changed: false }), data('new')])).reloads, 1);
  assert.match((await run([response({ ok: false, error: { message: 'HTTP 567' } })])).notice, /HTTP 567/);
  assert.match((await run([response('', 'text/html'), response({ ok: false, checked_at: 'today', error: { message: 'blocked' } })])).notice, /blocked/);
  assert.match((await run([], 'file:')).notice, /无法自动更新/);
  console.log('5 auto-update regression checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
