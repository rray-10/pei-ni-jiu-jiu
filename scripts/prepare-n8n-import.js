'use strict';
// Fills REPLACE_* placeholders in n8n/main-flow.json and writes an import-ready copy to n8n/import/ (git-ignored).
// Usage: node scripts/prepare-n8n-import.js STAGING_SPREADSHEET_ID=<spreadsheet id> ADMIN_LINE_USER_ID=<admin userId>
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'n8n');
let text = fs.readFileSync(path.join(root, 'main-flow.json'), 'utf8');
for (const arg of process.argv.slice(2)) {
  const index = arg.indexOf('=');
  if (index > 0 && arg.slice(index + 1)) text = text.split('REPLACE_' + arg.slice(0, index)).join(arg.slice(index + 1));
}
fs.mkdirSync(path.join(root, 'import'), {recursive: true});
fs.writeFileSync(path.join(root, 'import', 'main-flow.json'), text);
console.log('wrote n8n/import/main-flow.json');
const leftovers = new Set(text.match(/REPLACE_[A-Z_]+/g) || []);
if (leftovers.size) console.log('Still unfilled (set in n8n or pass KEY=value):', [...leftovers].join(', '));
