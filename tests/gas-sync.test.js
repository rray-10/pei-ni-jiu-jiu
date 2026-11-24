const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs');
test('gas/dashboard 與 adapters 同步', () => {
  for (const f of ['health-adapter', 'dashboard-service']) {
    const src = fs.readFileSync(`adapters/${f}.js`, 'utf8');
    const gas = fs.readFileSync(`gas/dashboard/${f}.gs`, 'utf8');
    assert.ok(gas.endsWith(src), `${f}.gs 已過期，請執行 npm run sync:gas`);
  }
});
test('repo 不含疑似密鑰或真實 LINE UID', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.name === 'node_modules' || e.name === '.git' || (d === '.' && e.name === 'file') || /^\.env(?!\.example$)/.test(e.name) ? [] : e.isDirectory() ? walk(d + '/' + e.name) : [d + '/' + e.name]);
  for (const f of walk('.')) {
    if (f.endsWith('gas-sync.test.js')) continue;
    const t = fs.readFileSync(f, 'utf8');
    assert.equal(/\bU[0-9a-f]{32}\b/.test(t), false, `真實格式 LINE UID 出現在 ${f}`);
    assert.equal(/eyJ[A-Za-z0-9_-]{20,}\./.test(t), false, `疑似 JWT/Token 出現在 ${f}`);
  }
});
