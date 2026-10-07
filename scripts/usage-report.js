// Cost report from the usage ledger (data/usage.jsonl), optionally reconciled against a provider export.
//   npm run usage                                  typical session, top 5%, per mystery, by capability/model
//   npm run usage -- --json                        the same as JSON
//   npm run usage -- --reconcile export.json       compare ledger buckets with the provider's numbers
//   npm run usage -- --reprice 2026-10-07          re-price every record with one price book
//   npm run usage -- --file path/to/usage.jsonl
import fs from 'node:fs';
import { readLedgerFile } from '../src/ai/ledger.js';
import { buildReport, formatReport, reconcile, priceExport } from '../src/ai/report.js';
import { dataFile } from '../src/paths.js';

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const file = arg('--file') || dataFile('usage.jsonl');
const records = readLedgerFile(file);
if (!records.length) {
  console.log(`No usage records in ${file} yet. Play a little, then run this again.`);
  process.exit(0);
}
const report = buildReport(records, { version: arg('--reprice') || undefined });
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else console.log(formatReport(report));

const exp = arg('--reconcile');
if (exp) {
  const data = JSON.parse(fs.readFileSync(exp, 'utf8'));
  console.log('\nReconciliation (ledger minus provider):');
  for (const r of reconcile(records, data)) {
    console.log(`  ${r.model.padEnd(24)} ${r.field.padEnd(30)} provider ${String(r.provider).padStart(9)}  ledger ${String(r.ledger).padStart(9)}  ${r.diffPct == null ? '' : `${r.diffPct > 0 ? '+' : ''}${r.diffPct}%`}`);
  }
  const priced = priceExport(data);
  if (Object.keys(priced).length) {
    console.log('\nPrice book check (provider buckets priced with our rates):');
    for (const [m, p] of Object.entries(priced)) console.log(`  ${m.padEnd(26)} provider $${p.provider}  estimate $${p.estimated}`);
  }
}
