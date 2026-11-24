'use strict';
// Fills REPLACE_* placeholders in the n8n test exports and writes import-ready copies to n8n/import/ (git-ignored).
// Usage: node scripts/prepare-n8n-import.js STAGING_BIND_LIFF_BASE=https://liff.line.me/<LIFF_ID> \
//          STAGING_SPREADSHEET_ID=<care workbook id> STAGING_APPT_SPREADSHEET_ID=<appointments workbook id> [KEY=value ...]
const fs = require('node:fs');
const path = require('node:path');

const values = Object.fromEntries(process.argv.slice(2).map(arg => {
  const index = arg.indexOf('=');
  return index < 1 ? [arg, ''] : [arg.slice(0, index), arg.slice(index + 1)];
}));
// The care workbook is referenced by two placeholder names; one value fills both.
if (values.STAGING_SPREADSHEET_ID && !values.STAGING_F1_SPREADSHEET_ID) values.STAGING_F1_SPREADSHEET_ID = values.STAGING_SPREADSHEET_ID;
const root = path.join(__dirname, '..', 'n8n');
const out = path.join(root, 'import');
fs.mkdirSync(out, {recursive: true});
const leftovers = new Set();
for (const dir of fs.readdirSync(root, {withFileTypes: true}).filter(entry => entry.isDirectory() && !['source', 'import'].includes(entry.name))) {
  for (const file of fs.readdirSync(path.join(root, dir.name)).filter(name => name.endsWith('.json'))) {
    let text = fs.readFileSync(path.join(root, dir.name, file), 'utf8');
    for (const [key, value] of Object.entries(values)) {
      if (value) text = text.split('REPLACE_' + key).join(value);
    }
    for (const match of text.match(/REPLACE_[A-Z_]+/g) || []) leftovers.add(match);
    fs.writeFileSync(path.join(out, dir.name + '-' + file), text);
    console.log('wrote n8n/import/' + dir.name + '-' + file);
  }
}
if (leftovers.size) console.log('Still unfilled (set in n8n or pass KEY=value):', [...leftovers].join(', '));
